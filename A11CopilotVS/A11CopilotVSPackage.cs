using System;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace A11CopilotVS
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("A-11 Copilot", "Assistant A-11 local", "1.0")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(A11ToolWindow))]
    [Guid(PackageGuidString)]
    public sealed class A11CopilotVSPackage : AsyncPackage
    {
        public const string PackageGuidString = "12345678-abcd-4abc-9abc-1234567890ab";

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            await A11ToolWindowCommand.InitializeAsync(this);
        }
    }
}