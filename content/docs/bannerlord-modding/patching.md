+++
title = "Patching"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 10
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = 'Harmony is the library used to monkey patch "unchangable" methods.'
toc = true
top = false
+++

In this section we will cover the most common cases where we need this library, and if for some reason you need to know more, here is [the official documentation](https://harmony.pardeike.net/).

## Prefix

The [`prefix`](https://harmony.pardeike.net/articles/patching-prefix.html) allows patching of existing methods before they execute. Prefixes are mainly used to replace existing methods.

<details>
    <summary>View full example</summary>

```C#
using HarmonyLib;
using System;
using System.Reflection;

namespace ConsoleApp
{
    // Example of Bannerlord code. Uneditable code.
    class Foo
    {
        private int myVar;

        public void PrintMyVar()
        {
            Console.WriteLine(myVar);
        }

        // Method we want to change.
        public void SetMyVar(int newInt)
        {
            myVar = newInt;
        }
    }

    [HarmonyPatch(typeof(Foo), "SetMyVar")]
    class FooPatch
    {
        // __instance works similar to the 'this' keyword
        static bool Prefix(ref Foo __instance, ref int newInt)
        {
            // Access private field
            FieldInfo myVarField = typeof(Foo).GetField("myVar", BindingFlags.Instance | BindingFlags.NonPublic);
            // Set newInto of __instance
            myVarField.SetValue(__instance, newInt + 1);

            // Returning false skips original method
            return false;
        }
    }


    class Program
    {
        static void Main(string[] args)
        {
            Harmony harmony = new Harmony("com.company.project.product");

            Foo foo = new Foo();

            foo.SetMyVar(2);
            foo.PrintMyVar(); // -> 2

            harmony.PatchAll();

            foo.SetMyVar(2);
            foo.PrintMyVar(); // -> 3

            Console.ReadKey();
        }
    }
}
```
</details>


## Postfix

The [`postfix`](https://harmony.pardeike.net/articles/patching-postfix.html) allows patching of existing methods after they execute. Postfixes are normally used to replace return values.

<details>
<summary>Preview full example</summary>

```C#
using HarmonyLib;
using System;

namespace ConsoleApp
{
    // Example of Bannerlord code. Uneditable code.
    class Foo
    {
        private int myVar = 2;

        public void PrintMyVar()
        {
            Console.WriteLine(myVar);
        }

        // Method we want to change.
        public int GetMyVar()
        {
            return myVar;
        }
    }

    [HarmonyPatch(typeof(Foo), "GetMyVar")]
    class FooPatch
    {
        // __result is the return value of the original method
        static int Postfix(int __result)
        {
            // This will overwrite the return value
            return __result + 1;
        }
    }


    class Program
    {
        static void Main(string[] args)
        {
            Harmony harmony = new Harmony("com.company.project.product");

            Foo foo = new Foo();

            Console.WriteLine(foo.GetMyVar()); // -> 2

            // Apply patch
            harmony.PatchAll();

            Console.WriteLine(foo.GetMyVar()); // -> 3

            Console.ReadKey();
        }
    }
}
```
</details>


## Transpiler

Transpilers work directly with the compiled C# code, aka MSIL.
This is an advanced topic and we should use this **sparingly**, for more information see [here](https://harmony.pardeike.net/articles/patching-transpiler.html).

### Tool

The library [`HarmonyTranspilerTool`](https://github.com/garrettluskey/HarmonyTranspilerTools) that can help with transpilers by searching and replacing specific IL code.
