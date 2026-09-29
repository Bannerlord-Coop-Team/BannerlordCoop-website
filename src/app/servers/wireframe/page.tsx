import type { Metadata } from "next";
import ServerWireframe from "./ServerWireframe";

export const metadata: Metadata = {
    title: "Server UX wireframe",
    description: "Public, interactive server management wireframe. Fictional data; no live server access.",
    robots: { index: false, follow: false },
};

export default function ServerWireframePage() {
    return <ServerWireframe />;
}
