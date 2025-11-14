using System;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace A11CopilotVS
{
    [Guid("fedcba98-7654-4321-baba-abcdef123456")]
    public class A11ToolWindow : ToolWindowPane
    {
        public A11ToolWindow() : base(null)
        {
            Caption = "A-11 Copilot";
            Content = new A11ToolWindowControl();
        }
    }
}