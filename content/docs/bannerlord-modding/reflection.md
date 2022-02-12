+++
title = "Reflection"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 12
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = 'You can be blocked when you want to reach private or protected variables, we have the perfect solution for you.'
toc = true
top = false
+++

## Reading and Writing to a Private Variable

Let's take this Foo class as an example

```C#
using System;
using System.Reflection;

class Foo {
    private string _bar = "private bar";

    public void printBar() {
        Console.WriteLine(_bar);
    }
}
```

To read and write to a private variable, we use the `FieldInfo` class as below:

```C#
using System;
using System.Reflection;

Foo foo = new Foo();
foo.printBar(); // Output "private_bar"

FieldInfo fieldInfo = typeof(Foo).GetField("_bar", BindingFlags.NonPublic | BindingFlags.Instance);

string bar = (string) fieldInfo.GetValue(foo);
Console.WriteLine(bar); // Output "private_bar"

fieldInfo.SetValue(foo, "I set a new value!");
foo.printBar(); // Output "I set a new value!"
```

## Instantiating a Internal/Private Class

For this example, we have this class `PrivateClass` that is inacessible.

```C#
namespace ConsoleApp.Private {

    class PrivateClass {
        public int someVar = 5;
    }
}
```

```C#
using System;
using System.Reflection;

// Activator
// Need to get assembly when getting type, need full namespace type name as well.
// Assembly may be different, you can pull assembly off public types
Type privateType = Assembly.GetCallingAssembly().GetType("ConsoleApp.Private.PrivateClass");

// Create class given a type
object privateClass = Activator.CreateInstance(privateType);

// Get someVar field value and print it
Console.WriteLine(privateType.GetField("someVar").GetValue(privateClass));
```