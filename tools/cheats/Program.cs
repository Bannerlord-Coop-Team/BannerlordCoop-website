using System.Diagnostics;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

// Read declarations only: never load mod assemblies or execute command constructors.
if (args.Length != 2) throw new ArgumentException("Usage: dotnet run --project tools/cheats -- <repo> <commit>");
string Git(params string[] arguments)
{
    var info = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true };
    info.ArgumentList.Add("-C");
    info.ArgumentList.Add(args[0]);
    foreach (var argument in arguments) info.ArgumentList.Add(argument);
    using var process = Process.Start(info)!;
    var result = process.StandardOutput.ReadToEnd();
    var error = process.StandardError.ReadToEnd();
    process.WaitForExit();
    if (process.ExitCode != 0) throw new InvalidOperationException(error);
    return result;
}
var commit = Git("rev-parse", "--verify", args[1] + "^{commit}").Trim();
var commands = new List<object>();
var names = new HashSet<string>();
var debugOnly = new List<string>();
var sources = Git("ls-tree", "-r", "--name-only", commit, "source/Common", "source/GameInterface", "source/Missions")
    .Split('\n').Where(p => p.EndsWith(".cs")).ToDictionary(path => path, path => Git("show", $"{commit}:{path}"));
var release = CommandClasses(sources, false);
var debug = CommandClasses(sources, true);
foreach (var (type, declaration) in debug)
{
    if (!release.ContainsKey(type)) debugOnly.Add(Text(declaration, "Prefix") + "." + Text(declaration, "Name"));
}
foreach (var declaration in release.Values)
{
    var path = declaration.SyntaxTree.FilePath;
    var prefix = Text(declaration, "Prefix");
    var name = Text(declaration, "Name");
    var fullName = prefix + "." + name;
    if (!System.Text.RegularExpressions.Regex.IsMatch(fullName, @"^coop(?:\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*)+$"))
        throw new InvalidOperationException($"Non snake-case command: {fullName}");
    if (!names.Add(fullName)) throw new InvalidOperationException($"Duplicate command: {fullName}");
    var property = Property(declaration, "ExpectedArgs");
    var expression = property.Initializer?.Value ?? property.ExpressionBody?.Expression;
    if (expression is InvocationExpressionSyntax invocation && invocation.Expression is IdentifierNameSyntax helper && invocation.ArgumentList.Arguments.Count == 0)
    {
        var method = declaration.AncestorsAndSelf().OfType<ClassDeclarationSyntax>().SelectMany(c => c.Members.OfType<MethodDeclarationSyntax>())
            .Single(m => m.Identifier.Text == helper.Identifier.Text && m.Modifiers.Any(SyntaxKind.StaticKeyword) && m.ParameterList.Parameters.Count == 0);
        expression = method.ExpressionBody?.Expression ?? throw new InvalidOperationException("Only expression-bodied argument factories are supported.");
    }
    var expectedArgs = new List<object>();
    if (expression is ArrayCreationExpressionSyntax array && array.Initializer != null)
    {
        foreach (var element in array.Initializer.Expressions)
        {
            if (element is not ObjectCreationExpressionSyntax creation || creation.Type.ToString() != "ExpectedArgs" || creation.ArgumentList == null)
                throw new InvalidOperationException($"Unsupported argument metadata: {fullName}");
            var values = creation.ArgumentList.Arguments;
            if (values.Count is < 2 or > 3 || values.Take(2).Any(v => v.NameColon != null) || (values.Count == 3 && values[2].NameColon != null && values[2].NameColon!.Name.Identifier.Text != "isRequired")) throw new InvalidOperationException(fullName);
            var required = values.Count == 2 || values[2].Expression.IsKind(SyntaxKind.TrueLiteralExpression);
            if (values.Count == 3 && !required && !values[2].Expression.IsKind(SyntaxKind.FalseLiteralExpression)) throw new InvalidOperationException(fullName);
            expectedArgs.Add(new { name = Literal(values[0].Expression, declaration), description = Literal(values[1].Expression, declaration), required });
        }
    }
    else if (expression?.ToString() is not ("System.Array.Empty<IExpectedArgs>()" or "Array.Empty<IExpectedArgs>()"))
        throw new InvalidOperationException($"Unsupported ExpectedArgs: {fullName}: {expression}");
    var sideExpression = Property(declaration, "Side").ExpressionBody?.Expression.ToString();
    var side = sideExpression switch {
        "CoopCommandSide.Both" => "either",
        "CoopCommandSide.Server" => "server",
        "CoopCommandSide.Client" => "client",
        _ => throw new InvalidOperationException($"Unsupported Side: {fullName}: {sideExpression}"),
    };
    commands.Add(new { command = fullName, name, group = prefix, summary = Text(declaration, "Description"), side, arguments = expectedArgs,
        source = new { path, type = declaration.Identifier.Text, line = declaration.GetLocation().GetLineSpan().StartLinePosition.Line + 1 } });
}
if (commands.Count == 0) throw new InvalidOperationException("No release commands found; check the repository and registration scope.");
Console.WriteLine(JsonSerializer.Serialize(new { commit, commands, debugOnly }, new JsonSerializerOptions { WriteIndented = true }));

static CompilationUnitSyntax Parse(string source, string path, bool debug)
{
    var tree = CSharpSyntaxTree.ParseText(source, new CSharpParseOptions(preprocessorSymbols: debug ? new[] { "DEBUG", "TRACE" } : new[] { "TRACE" }), path);
    var errors = tree.GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).ToArray();
    if (errors.Length != 0) throw new InvalidOperationException(string.Join("\n", errors.Select(e => e.ToString())));
    return tree.GetCompilationUnitRoot();
}
static Dictionary<string, ClassDeclarationSyntax> CommandClasses(Dictionary<string, string> sources, bool debug)
{
    var trees = sources.Select(source => Parse(source.Value, source.Key, debug).SyntaxTree).ToArray();
    // Symbol binding handles namespace imports, aliases and transitive interface/class inheritance.
    // No assembly is emitted or loaded, and unavailable game dependencies are not executed.
    var compilation = CSharpCompilation.Create("CheatMetadata", trees);
    var inheritanceErrors = compilation.GetDeclarationDiagnostics().Where(d => d.Id is "CS0146" or "CS0529").ToArray();
    if (inheritanceErrors.Length > 0) throw new InvalidOperationException("Cyclic source inheritance: " + string.Join("; ", inheritanceErrors.Select(d => d.ToString())));
    var contract = compilation.GetTypeByMetadataName("Common.Commands.ICoopCommand")
        ?? throw new InvalidOperationException("Missing or ambiguous Common.Commands.ICoopCommand definition.");
    if (contract.TypeKind != TypeKind.Interface || contract.DeclaringSyntaxReferences.Length != 1)
        throw new InvalidOperationException("Unsupported or ambiguous Common.Commands.ICoopCommand definition.");
    var sourceTypeNames = trees.SelectMany(tree => tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        .Select(type => type.Identifier.Text).ToHashSet();
    var commands = new Dictionary<string, ClassDeclarationSyntax>();
    foreach (var tree in trees)
    {
        var model = compilation.GetSemanticModel(tree);
        foreach (var declaration in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
        {
            foreach (var baseType in declaration.BaseList?.Types ?? default)
            {
                var info = model.GetSymbolInfo(baseType.Type);
                var resolved = model.GetTypeInfo(baseType.Type).Type;
                if (info.CandidateReason == CandidateReason.Ambiguous ||
                    (resolved is IErrorTypeSymbol error && sourceTypeNames.Contains(error.Name)))
                    throw new InvalidOperationException($"Unsupported or ambiguous source base type: {tree.FilePath}: {baseType.Type}");
            }
            if (declaration is not ClassDeclarationSyntax concrete || model.GetDeclaredSymbol(concrete) is not INamedTypeSymbol symbol || symbol.IsAbstract)
                continue;
            if (!symbol.AllInterfaces.Contains(contract, SymbolEqualityComparer.Default)) continue;
            if (!tree.FilePath.StartsWith("source/GameInterface/") && !tree.FilePath.StartsWith("source/Missions/")) continue;
            if (symbol.IsGenericType || symbol.DeclaringSyntaxReferences.Length != 1)
                throw new InvalidOperationException($"Unsupported generic or partial command: {symbol}");
            commands.Add(symbol.ToDisplayString(), concrete);
        }
    }
    return commands;
}
static PropertyDeclarationSyntax Property(ClassDeclarationSyntax declaration, string name)
{
    var properties = declaration.Members.OfType<PropertyDeclarationSyntax>().Where(p => p.Identifier.Text == name).ToArray();
    return properties.Length == 1 ? properties[0] : throw new InvalidOperationException($"Unsupported inherited, missing or duplicate metadata property: {declaration.Identifier}.{name}");
}
static string Text(ClassDeclarationSyntax declaration, string property) => Literal(Property(declaration, property)
    .ExpressionBody?.Expression ?? throw new InvalidOperationException($"Unsupported {property}"), declaration);
static string Literal(ExpressionSyntax expression, ClassDeclarationSyntax declaration)
{
    if (expression is LiteralExpressionSyntax literal && literal.IsKind(SyntaxKind.StringLiteralExpression)) return literal.Token.ValueText;
    if (expression is BinaryExpressionSyntax binary && binary.IsKind(SyntaxKind.AddExpression)) return Literal(binary.Left, declaration) + Literal(binary.Right, declaration);
    if (expression is IdentifierNameSyntax identifier)
    {
        foreach (var scope in declaration.AncestorsAndSelf().OfType<ClassDeclarationSyntax>())
        {
            var variable = scope.Members.OfType<FieldDeclarationSyntax>().Where(f => f.Modifiers.Any(SyntaxKind.ConstKeyword))
                .SelectMany(f => f.Declaration.Variables).SingleOrDefault(v => v.Identifier.Text == identifier.Identifier.Text);
            if (variable?.Initializer != null) return Literal(variable.Initializer.Value, scope);
        }
    }
    throw new InvalidOperationException($"Unsupported metadata expression: {expression}");
}
