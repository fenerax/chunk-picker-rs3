$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class InflaterFileUsers {
  [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME start; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo {
    public UniqueProcess process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
    public uint type, status, session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint session, uint files, string[] names, uint apps, IntPtr processes, uint services, string[] serviceNames);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint session, out uint needed, ref uint count, [In, Out] ProcessInfo[] processes, ref uint reasons);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetFileAttributes(string file);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string file, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  public static int DeleteAccessError(string file) {
    using (var handle = CreateFile(file, 0x10000, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) return handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
  }
  public static ProcessInfo[] Find(string file) {
    uint session; int error = RmStartSession(out session, 0, new StringBuilder(33));
    if (error != 0) throw new Exception("RmStartSession: " + error);
    try {
      error = RmRegisterResources(session, 1, new string[] {file}, 0, IntPtr.Zero, 0, null);
      if (error != 0) throw new Exception("RmRegisterResources: " + error);
      uint needed, count = 0, reasons = 0;
      error = RmGetList(session, out needed, ref count, null, ref reasons);
      if (error == 0) return new ProcessInfo[0];
      if (error != 234) throw new Exception("RmGetList: " + error);
      var rows = new ProcessInfo[needed]; count = needed;
      error = RmGetList(session, out needed, ref count, rows, ref reasons);
      if (error != 0) throw new Exception("RmGetList snapshot changed: " + error);
      Array.Resize(ref rows, (int)count); return rows;
    } finally { RmEndSession(session); }
  }
}
'@
$heldFile = $null
try {
  while ($null -ne ($line = [Console]::ReadLine())) {
    try {
      $request = $line | ConvertFrom-Json
      switch ($request.operation) {
        'ready' { $reply = @{ ready = $true; pid = $PID } }
        'hold' {
          if ($heldFile) { throw 'Already holding a probe file.' }
          $heldFile = [IO.File]::Open($request.file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
          $reply = @{ held = $true; pid = $PID }
        }
        'release' { $heldFile.Dispose(); $heldFile = $null; $reply = @{ released = $true } }
        'inspect' {
          $rows = @($request.files | ForEach-Object {
            $file = $_
            $deleteError = [InflaterFileUsers]::DeleteAccessError($file)
            $users = @([InflaterFileUsers]::Find($file) | ForEach-Object { @{ pid = $_.process.pid; name = $_.name } })
            @{ file = [IO.Path]::GetFileName($file); attributes = [InflaterFileUsers]::GetFileAttributes($file); deleteAccessError = $deleteError; users = $users }
          })
          $reply = @{ files = $rows }
        }
        default { throw 'Unknown probe operation.' }
      }
      [Console]::WriteLine(($reply | ConvertTo-Json -Depth 6 -Compress))
    } catch { [Console]::WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
  }
} finally { if ($heldFile) { $heldFile.Dispose() } }
