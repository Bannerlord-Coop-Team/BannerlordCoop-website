// @ts-nocheck -- Deno npm specifiers are validated by the Edge deployment.
import { PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3";

// Edge Function: create-github-issue-bug-report
//
// Accepts one multipart PUT containing:
//   report: JSON metadata
//   serverLog: optional gzip file
//   clientLog-{clientNumber}: optional gzip files
//   serverSave: optional Bannerlord save
//   serverSaveSidecar: optional paired co-op session JSON
//
// Supabase secrets:
// GITHUB_BUG_REPORTER_TOKEN
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// R2_ACCOUNT_ID
// R2_ACCESS_KEY
// R2_SECRET_ACCESS_KEY
// R2_PUBLIC_BASE_URL
//
// Optional:
// SUPABASE_BLACKLIST_TABLE   (default: bug_report_id_blacklist)
// SUPABASE_BLACKLIST_COLUMN  (default: network_id)

type LogDescriptor = {
  fileName: string;
  contentEncoding: "gzip";
  compressedLength: number;
  uncompressedLength: number;
};

type ClientLogDescriptor = LogDescriptor & {
  clientNumber: number;
};

type BugReportPayload = {
  schemaVersion: 3;
  reportId: string;
  reportingClientNetworkId: string;
  summary: string;
  description: string;
  triggers: string[];
  startedAtUtc: string;
  packagedAtUtc: string;
  moduleVersion: string;
  commit: string;
  buildVersion: string;
  serverLog: LogDescriptor | null;
  serverSave: null | {
    fileName: string;
    artifact: "server-save";
    length: number;
    sidecarFileName?: string | null;
    sidecarLength?: number | null;
  };
  clientLogs: ClientLogDescriptor[];
  submissions: Array<{
    reportingClientNetworkId: string;
    summary: string;
    description: string;
  }>;
  expectedClients: number;
  declinedClients: number;
  failedClients: number;
  timedOutClients: number;
};

type UploadedArtifact = {
  name: string;
  fileName: string;
  key: string;
  url: string;
  length: number;
  uncompressedLength?: number;
};

const MAX_TITLE_LEN = 120;
const MAX_REPORT_METADATA_BYTES = 256 * 1024;
const MAX_COMPRESSED_LOG_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_LOG_BYTES = 8 * 1024 * 1024;
const MAX_SERVER_SAVE_BYTES = 48 * 1024 * 1024;
const MAX_SERVER_SAVE_SIDECAR_BYTES = 8 * 1024 * 1024;
const MAX_CLIENT_LOGS = 256;

const GITHUB_OWNER = "Bannerlord-Coop-Team";
const GITHUB_REPO = "Bannerlord-Coop-Issues";
const R2_BUCKET = "bannerlord-coop-bug-reports";

const SUPABASE_BLACKLIST_TABLE =
  Deno.env.get("SUPABASE_BLACKLIST_TABLE") ?? "bug_report_id_blacklist";
const SUPABASE_BLACKLIST_COLUMN =
  Deno.env.get("SUPABASE_BLACKLIST_COLUMN") ?? "network_id";

function jsonResponse(data: unknown, status = 200) {
  if (status === 400) console.warn("Rejected bug report request:", data);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
  });
}

function getEnvRequired(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isIsoDateTime(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0;
}

function getSaveSidecarFileName(fileName: string) {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName =
    extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  return `${baseName}.json`;
}

function validateLogDescriptor(value: unknown, name: string): string | null {
  if (!value || typeof value !== "object") return `${name} is invalid`;
  const log = value as Partial<LogDescriptor>;
  if (!log.fileName || typeof log.fileName !== "string") {
    return `${name}.fileName is required`;
  }
  if (log.contentEncoding !== "gzip") {
    return `${name}.contentEncoding must be gzip`;
  }
  if (!isPositiveInteger(log.compressedLength)) {
    return `${name}.compressedLength must be a positive integer`;
  }
  if (
    !isNonNegativeInteger(log.uncompressedLength) ||
    Number(log.uncompressedLength) > MAX_UNCOMPRESSED_LOG_BYTES
  ) {
    return `${name}.uncompressedLength is invalid`;
  }
  return null;
}

function validatePayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return "report metadata is required";
  const payload = value as Partial<BugReportPayload>;

  if (payload.schemaVersion !== 3) return "schemaVersion must be 3";
  if (
    typeof payload.reportId !== "string" ||
    !/^[0-9a-fA-F]{32}$/.test(payload.reportId)
  ) {
    return "reportId must be a compact GUID";
  }
  if (
    typeof payload.reportingClientNetworkId !== "string" ||
    payload.reportingClientNetworkId.length === 0 ||
    payload.reportingClientNetworkId.length > 200
  ) {
    return "reportingClientNetworkId is required";
  }
  if (typeof payload.summary !== "string" || payload.summary.length > 120) {
    return "summary is invalid";
  }
  if (
    typeof payload.description !== "string" ||
    payload.description.length > 2000
  ) {
    return "description is invalid";
  }
  if (
    !Array.isArray(payload.triggers) ||
    payload.triggers.length < 1 ||
    payload.triggers.length > 32 ||
    payload.triggers.some(
      (trigger) =>
        typeof trigger !== "string" ||
        trigger.length === 0 ||
        trigger.length > 100,
    )
  ) {
    return "triggers must be a non-empty string array";
  }
  if (
    typeof payload.startedAtUtc !== "string" ||
    !isIsoDateTime(payload.startedAtUtc)
  ) {
    return "startedAtUtc must be an ISO datetime string";
  }
  if (
    typeof payload.packagedAtUtc !== "string" ||
    !isIsoDateTime(payload.packagedAtUtc)
  ) {
    return "packagedAtUtc must be an ISO datetime string";
  }
  if (typeof payload.moduleVersion !== "string" || !payload.moduleVersion) {
    return "moduleVersion is required";
  }
  if (typeof payload.commit !== "string" || !payload.commit) {
    return "commit is required";
  }
  if (typeof payload.buildVersion !== "string" || !payload.buildVersion) {
    return "buildVersion is required";
  }

  if (payload.serverLog !== null) {
    const error = validateLogDescriptor(payload.serverLog, "serverLog");
    if (error) return error;
  }

  if (!Array.isArray(payload.clientLogs)) return "clientLogs must be an array";
  if (payload.clientLogs.length > MAX_CLIENT_LOGS) {
    return `clientLogs cannot exceed ${MAX_CLIENT_LOGS} entries`;
  }
  const clientNumbers = new Set<number>();
  for (const log of payload.clientLogs) {
    const error = validateLogDescriptor(log, "clientLog");
    if (error) return error;
    if (!isPositiveInteger(log.clientNumber)) {
      return "clientLog.clientNumber must be a positive integer";
    }
    if (clientNumbers.has(log.clientNumber)) {
      return "clientLog.clientNumber values must be unique";
    }
    clientNumbers.add(log.clientNumber);
  }

  if (payload.serverSave !== null) {
    if (!payload.serverSave || typeof payload.serverSave !== "object") {
      return "serverSave is invalid";
    }
    if (
      typeof payload.serverSave.fileName !== "string" ||
      payload.serverSave.fileName.length === 0 ||
      payload.serverSave.fileName.length > 200 ||
      /[\\/]/.test(payload.serverSave.fileName)
    ) {
      return "serverSave.fileName is invalid";
    }
    if (payload.serverSave.artifact !== "server-save") {
      return "serverSave.artifact must be server-save";
    }
    if (
      !isPositiveInteger(payload.serverSave.length) ||
      payload.serverSave.length > MAX_SERVER_SAVE_BYTES
    ) {
      return "serverSave.length is invalid";
    }

    const sidecarFileName = payload.serverSave.sidecarFileName ?? null;
    const sidecarLength = payload.serverSave.sidecarLength ?? null;
    if ((sidecarFileName === null) !== (sidecarLength === null)) {
      return "serverSave sidecar metadata must both be present";
    }
    if (
      sidecarFileName !== null &&
      (typeof sidecarFileName !== "string" ||
        sidecarFileName.length === 0 ||
        sidecarFileName.length > 200 ||
        /[\\/]/.test(sidecarFileName) ||
        sidecarFileName.toLowerCase() !==
          getSaveSidecarFileName(payload.serverSave.fileName).toLowerCase() ||
        !isPositiveInteger(sidecarLength) ||
        Number(sidecarLength) > MAX_SERVER_SAVE_SIDECAR_BYTES)
    ) {
      return "serverSave sidecar metadata is invalid";
    }
  }

  if (!Array.isArray(payload.submissions)) {
    return "submissions must be an array";
  }
  if (
    payload.submissions.some(
      (submission) =>
        !submission ||
        typeof submission.reportingClientNetworkId !== "string" ||
        typeof submission.summary !== "string" ||
        typeof submission.description !== "string",
    )
  ) {
    return "submissions contains an invalid entry";
  }

  for (const name of [
    "expectedClients",
    "declinedClients",
    "failedClients",
    "timedOutClients",
  ] as const) {
    if (!isNonNegativeInteger(payload[name])) return `${name} is invalid`;
  }

  return null;
}

async function isNetworkIdBlacklisted(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  networkId: string,
) {
  const url = new URL(
    `/rest/v1/${encodeURIComponent(SUPABASE_BLACKLIST_TABLE)}`,
    supabaseUrl,
  );
  url.searchParams.set("select", SUPABASE_BLACKLIST_COLUMN);
  url.searchParams.set(SUPABASE_BLACKLIST_COLUMN, `eq.${networkId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Supabase blacklist lookup failed (${res.status}): ${await res.text()}`,
    );
  }

  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

function sanitizePathComponent(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 200);
}

function cleanIssueText(value: string | null | undefined) {
  return String(value ?? "").replace(/\0/g, "");
}

function buildPublicR2Url(publicBaseUrl: string, key: string) {
  const base = publicBaseUrl.replace(/\/+$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodedKey}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getFilePart(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return value instanceof File ? value : null;
}

Deno.serve(async (req) => {
  if (req.method !== "PUT") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data")
  ) {
    return jsonResponse(
      { error: "Content-Type must be multipart/form-data" },
      415,
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse({ error: "Invalid multipart body" }, 400);
  }

  const reportPart = formData.get("report");
  let reportJson: string;
  if (typeof reportPart === "string") {
    reportJson = reportPart;
  } else if (reportPart instanceof File) {
    reportJson = await reportPart.text();
  } else {
    return jsonResponse({ error: "report multipart field is required" }, 400);
  }

  if (
    new TextEncoder().encode(reportJson).byteLength > MAX_REPORT_METADATA_BYTES
  ) {
    return jsonResponse({ error: "report metadata is too large" }, 413);
  }

  let payload: BugReportPayload;
  try {
    payload = JSON.parse(reportJson);
  } catch {
    return jsonResponse({ error: "report contains invalid JSON" }, 400);
  }

  const validationError = validatePayload(payload);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (idempotencyKey && idempotencyKey !== payload.reportId) {
    return jsonResponse({ error: "Idempotency-Key must match reportId" }, 400);
  }

  const serverLogFile = getFilePart(formData, "serverLog");
  if ((payload.serverLog === null) !== (serverLogFile === null)) {
    return jsonResponse(
      {
        error: "serverLog metadata and file must both be present",
      },
      400,
    );
  }
  if (
    payload.serverLog &&
    serverLogFile &&
    serverLogFile.size !== payload.serverLog.compressedLength
  ) {
    return jsonResponse(
      { error: "serverLog length does not match metadata" },
      400,
    );
  }

  const clientLogFiles = new Map<number, File>();
  for (const clientLog of payload.clientLogs) {
    const file = getFilePart(formData, `clientLog-${clientLog.clientNumber}`);
    if (!file) {
      return jsonResponse(
        {
          error: `Client ${clientLog.clientNumber}: multipart log is required`,
        },
        400,
      );
    }
    if (file.size !== clientLog.compressedLength) {
      return jsonResponse(
        {
          error: `Client ${clientLog.clientNumber}: log length does not match metadata`,
        },
        400,
      );
    }
    clientLogFiles.set(clientLog.clientNumber, file);
  }

  const totalCompressedLogBytes =
    (serverLogFile?.size ?? 0) +
    Array.from(clientLogFiles.values()).reduce(
      (total, file) => total + file.size,
      0,
    );
  if (totalCompressedLogBytes > MAX_COMPRESSED_LOG_BYTES) {
    return jsonResponse(
      { error: "Compressed logs exceed the upload limit" },
      413,
    );
  }

  const serverSaveFile = getFilePart(formData, "serverSave");
  if ((payload.serverSave === null) !== (serverSaveFile === null)) {
    return jsonResponse(
      {
        error: "serverSave metadata and file must both be present",
      },
      400,
    );
  }
  if (
    payload.serverSave &&
    serverSaveFile &&
    (serverSaveFile.size !== payload.serverSave.length ||
      serverSaveFile.size > MAX_SERVER_SAVE_BYTES)
  ) {
    return jsonResponse(
      { error: "serverSave length does not match metadata" },
      400,
    );
  }

  const serverSaveSidecarFile = getFilePart(formData, "serverSaveSidecar");
  const expectsServerSaveSidecar =
    payload.serverSave?.sidecarFileName != null &&
    payload.serverSave?.sidecarLength != null;
  if (expectsServerSaveSidecar !== (serverSaveSidecarFile !== null)) {
    return jsonResponse(
      {
        error: "serverSave sidecar metadata and file must both be present",
      },
      400,
    );
  }
  if (
    expectsServerSaveSidecar &&
    serverSaveSidecarFile &&
    (serverSaveSidecarFile.size !== payload.serverSave!.sidecarLength ||
      serverSaveSidecarFile.size > MAX_SERVER_SAVE_SIDECAR_BYTES)
  ) {
    return jsonResponse(
      { error: "serverSave sidecar length does not match metadata" },
      400,
    );
  }

  let githubToken: string;
  let supabaseUrl: string;
  let supabaseServiceRoleKey: string;
  let r2AccountId: string;
  let r2AccessKey: string;
  let r2SecretAccessKey: string;
  let r2PublicBaseUrl: string;

  try {
    githubToken = getEnvRequired("GITHUB_BUG_REPORTER_TOKEN");
    supabaseUrl = getEnvRequired("SUPABASE_URL");
    supabaseServiceRoleKey = getEnvRequired("SUPABASE_SERVICE_ROLE_KEY");
    r2AccountId = getEnvRequired("R2_ACCOUNT_ID");
    r2AccessKey = getEnvRequired("R2_ACCESS_KEY");
    r2SecretAccessKey = getEnvRequired("R2_SECRET_ACCESS_KEY");
    r2PublicBaseUrl = getEnvRequired("R2_PUBLIC_BASE_URL");
  } catch (err) {
    console.error("Configuration error:", err);
    return jsonResponse(
      {
        error: "Server configuration error",
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  try {
    const blacklisted = await isNetworkIdBlacklisted(
      supabaseUrl,
      supabaseServiceRoleKey,
      payload.reportingClientNetworkId,
    );
    if (blacklisted) {
      console.warn(
        "Rejected blacklisted bug reporter:",
        payload.reportingClientNetworkId,
      );
      return jsonResponse({ error: "Bug report rejected" }, 403);
    }
  } catch (err) {
    console.error("Supabase blacklist check failed:", err);
    return jsonResponse({ error: "Unable to verify reporter" }, 503);
  }

  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2AccessKey,
      secretAccessKey: r2SecretAccessKey,
    },
  });

  const safeReportId = sanitizePathComponent(payload.reportId);
  const reportPrefix = `bug-reports/${safeReportId}`;
  const uploadedLogs: UploadedArtifact[] = [];
  let uploadedServerSave: UploadedArtifact | null = null;
  let uploadedServerSaveSidecar: UploadedArtifact | null = null;

  try {
    if (payload.serverSave && serverSaveFile) {
      const fileName = sanitizePathComponent(payload.serverSave.fileName);
      const key = `${reportPrefix}/server/${fileName}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: new Uint8Array(await serverSaveFile.arrayBuffer()),
          ContentType: "application/octet-stream",
          ContentDisposition: `attachment; filename="${fileName}"`,
          Metadata: {
            reportid: payload.reportId,
            artifact: "server-save",
            moduleversion: payload.moduleVersion,
            commit: payload.commit,
          },
        }),
      );
      uploadedServerSave = {
        name: "Server Save",
        fileName,
        key,
        url: buildPublicR2Url(r2PublicBaseUrl, key),
        length: serverSaveFile.size,
      };
    }

    if (payload.serverSave?.sidecarFileName && serverSaveSidecarFile) {
      const fileName = sanitizePathComponent(
        payload.serverSave.sidecarFileName,
      );
      const key = `${reportPrefix}/server/${fileName}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: new Uint8Array(await serverSaveSidecarFile.arrayBuffer()),
          ContentType: "application/json",
          ContentDisposition: `attachment; filename="${fileName}"`,
          Metadata: {
            reportid: payload.reportId,
            artifact: "server-save-sidecar",
            moduleversion: payload.moduleVersion,
            commit: payload.commit,
          },
        }),
      );
      uploadedServerSaveSidecar = {
        name: "Server Save Sidecar",
        fileName,
        key,
        url: buildPublicR2Url(r2PublicBaseUrl, key),
        length: serverSaveSidecarFile.size,
      };
    }

    if (payload.serverLog && serverLogFile) {
      const safeFileName = sanitizePathComponent(payload.serverLog.fileName);
      const gzFileName = safeFileName.endsWith(".gz")
        ? safeFileName
        : `${safeFileName}.gz`;
      const key = `${reportPrefix}/server/${gzFileName}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: new Uint8Array(await serverLogFile.arrayBuffer()),
          ContentType: "application/gzip",
          ContentDisposition: `attachment; filename="${gzFileName}"`,
          Metadata: {
            reportid: payload.reportId,
            logtype: "server",
            moduleversion: payload.moduleVersion,
            commit: payload.commit,
            uncompressedlength: String(payload.serverLog.uncompressedLength),
          },
        }),
      );
      uploadedLogs.push({
        name: "Server Log",
        fileName: gzFileName,
        key,
        url: buildPublicR2Url(r2PublicBaseUrl, key),
        length: serverLogFile.size,
        uncompressedLength: payload.serverLog.uncompressedLength,
      });
    }

    for (const clientLog of payload.clientLogs) {
      const file = clientLogFiles.get(clientLog.clientNumber)!;
      const safeOriginalName = sanitizePathComponent(clientLog.fileName);
      const nameWithoutGz = safeOriginalName.endsWith(".gz")
        ? safeOriginalName.slice(0, -3)
        : safeOriginalName;
      const gzFileName = `client-${clientLog.clientNumber}-${nameWithoutGz}.gz`;
      const key = `${reportPrefix}/clients/${gzFileName}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: new Uint8Array(await file.arrayBuffer()),
          ContentType: "application/gzip",
          ContentDisposition: `attachment; filename="${gzFileName}"`,
          Metadata: {
            reportid: payload.reportId,
            logtype: "client",
            clientnumber: String(clientLog.clientNumber),
            moduleversion: payload.moduleVersion,
            commit: payload.commit,
            uncompressedlength: String(clientLog.uncompressedLength),
          },
        }),
      );
      uploadedLogs.push({
        name: `Client ${clientLog.clientNumber} Log`,
        fileName: gzFileName,
        key,
        url: buildPublicR2Url(r2PublicBaseUrl, key),
        length: file.size,
        uncompressedLength: clientLog.uncompressedLength,
      });
    }
  } catch (err) {
    console.error("R2 upload failed:", err);
    return jsonResponse(
      {
        error: "R2 artifact upload failed",
        details: err instanceof Error ? err.message : String(err),
        serverSave: uploadedServerSave,
        serverSaveSidecar: uploadedServerSaveSidecar,
        uploadedLogs,
      },
      502,
    );
  }

  const summary = cleanIssueText(payload.summary).trim();
  const titleBase = summary
    ? `Bug: ${summary}`
    : `Bug Report (${payload.moduleVersion})`;
  const title = titleBase.replace(/[\r\n]+/g, " ").slice(0, MAX_TITLE_LEN);

  const logsSection =
    uploadedLogs.length === 0
      ? "(no logs uploaded)"
      : uploadedLogs
          .map((log) =>
            [
              `- **${log.name}**: [${log.fileName}](${log.url})`,
              `  - Compressed: ${formatBytes(log.length)}`,
              `  - Uncompressed: ${formatBytes(log.uncompressedLength ?? -1)}`,
            ].join("\n"),
          )
          .join("\n");

  const saveArtifacts = [uploadedServerSave, uploadedServerSaveSidecar].filter(
    (artifact): artifact is UploadedArtifact => artifact !== null,
  );
  const saveSection =
    saveArtifacts.length > 0
      ? saveArtifacts
          .map((artifact) =>
            [
              `- **${artifact.name}**: [${artifact.fileName}](${artifact.url})`,
              `  - Size: ${formatBytes(artifact.length)}`,
            ].join("\n"),
          )
          .join("\n")
      : "(no server save uploaded)";

  const submissionsSection =
    payload.submissions.length === 0
      ? "(none)"
      : payload.submissions
          .map((submission, index) =>
            [
              `#### Submission ${index + 1}`,
              "",
              `- **Network ID**: ${cleanIssueText(
                submission.reportingClientNetworkId,
              )}`,
              "",
              "**Summary**",
              "",
              cleanIssueText(submission.summary) || "(none)",
              "",
              "**Description**",
              "",
              cleanIssueText(submission.description) || "(none)",
            ].join("\n"),
          )
          .join("\n\n");

  const body = [
    "### BannerlordCoop Bug Report",
    "",
    `- **Report ID**: ${cleanIssueText(payload.reportId)}`,
    `- **Reporting Network ID**: ${cleanIssueText(
      payload.reportingClientNetworkId,
    )}`,
    `- **Module Version**: ${cleanIssueText(payload.moduleVersion)}`,
    `- **Build Version**: ${cleanIssueText(payload.buildVersion)}`,
    `- **Commit**: ${cleanIssueText(payload.commit)}`,
    `- **Started (UTC)**: ${cleanIssueText(payload.startedAtUtc)}`,
    `- **Packaged (UTC)**: ${cleanIssueText(payload.packagedAtUtc)}`,
    `- **Triggers**: ${payload.triggers.map(cleanIssueText).join(", ")}`,
    `- **Counts**: expected=${payload.expectedClients}, declined=${payload.declinedClients}, failed=${payload.failedClients}, timedOut=${payload.timedOutClients}`,
    "",
    "### Summary",
    "",
    summary || "(none)",
    "",
    "### Description",
    "",
    cleanIssueText(payload.description) || "(none)",
    "",
    "### Server Save",
    "",
    saveSection,
    "",
    "### Logs",
    "",
    logsSection,
    "",
    "### Client Submissions",
    "",
    submissionsSection,
  ].join("\n");

  const githubUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`;
  const ghRes = await fetch(githubUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "bannerlord-coop-bug-reporter",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body, type: "Bug" }),
  });

  const ghText = await ghRes.text();
  let ghJson: unknown = null;
  try {
    ghJson = ghText ? JSON.parse(ghText) : null;
  } catch {
    ghJson = { raw: ghText };
  }

  if (!ghRes.ok) {
    console.error("GitHub issue creation failed:", ghRes.status, ghText);
    return jsonResponse(
      {
        error: "GitHub issue creation failed",
        status: ghRes.status,
        github: ghJson,
        serverSave: uploadedServerSave,
        serverSaveSidecar: uploadedServerSaveSidecar,
        uploadedLogs,
      },
      502,
    );
  }

  const issue = ghJson as Record<string, unknown> | null;
  return jsonResponse({
    ok: true,
    reportId: payload.reportId,
    github: {
      id: issue?.id,
      number: issue?.number,
      html_url: issue?.html_url,
      title: issue?.title,
    },
    serverSave: uploadedServerSave,
    serverSaveSidecar: uploadedServerSaveSidecar,
    logs: uploadedLogs,
  });
});
