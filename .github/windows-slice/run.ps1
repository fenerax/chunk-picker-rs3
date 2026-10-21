# Starts the Windows job with Windows 11's file ownership.
# Hosted runners are Windows Server with an elevated admin, so new files are
# owned by BUILTIN\Administrators; on Player 1's PC the creating user owns them.
# The operator's verify-security requires the user as owner, so this sets the
# job's process-token default owner to the user. Node and its children inherit it.
param([Parameter(Mandatory=$true)][string]$Checkout, [Parameter(Mandatory=$true)][string]$Work)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class SliceTokenOwner {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int infoClass, ref IntPtr info, int length);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void UseCurrentUser() {
    const uint TOKEN_ADJUST_DEFAULT = 0x0080; const int TokenOwner = 4;
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_DEFAULT, out token)) throw new Win32Exception();
    SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
    byte[] bytes = new byte[user.BinaryLength]; user.GetBinaryForm(bytes, 0);
    IntPtr sid = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, sid, bytes.Length);
      // TOKEN_OWNER is a single PSID.
      if (!SetTokenInformation(token, TokenOwner, ref sid, IntPtr.Size)) throw new Win32Exception();
    } finally { Marshal.FreeHGlobal(sid); CloseHandle(token); }
  }
}
'@
[SliceTokenOwner]::UseCurrentUser()

# Prove it from a child process, the way the tests create files.
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$probe = Join-Path $env:RUNNER_TEMP 'owner-probe.txt'
& node -e "require('fs').writeFileSync(process.argv[1], 'x')" $probe
$owner = (Get-Acl -LiteralPath $probe).GetOwner([Security.Principal.SecurityIdentifier]).Value
Remove-Item -LiteralPath $probe
if ($owner -ne $user) { throw "New files are owned by $owner, not the runner user $user." }
Write-Output "New files are owned by the runner user ($user), as on Windows 11."

& node (Join-Path $PSScriptRoot 'run.mjs') $Checkout $Work
exit $LASTEXITCODE
