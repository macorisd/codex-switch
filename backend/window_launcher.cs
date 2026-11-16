// Windows bootstrap only. All provider logic stays in the bundled Python source.
// .NET Framework is part of supported desktop Windows; no runtime downloads.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Threading;

class WindowLauncher {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string b);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr h, int c, IntPtr p, uint n);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr h, IntPtr p);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, IntPtr[] p, int n, out int length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);
    static string Executable(Process process) {
        int size = 32768; var name = new StringBuilder(size);
        if (!QueryFullProcessImageName(process.Handle, 0, name, ref size))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return name.ToString();
    }
    // The limit structure is 144 bytes on x64/ARM64, 112 on x86. LimitFlags is
    // at offset 16 on all three. KILL_ON_JOB_CLOSE prevents orphan app servers.
    static IntPtr Job() {
        IntPtr h = CreateJobObject(IntPtr.Zero, null);
        int size = IntPtr.Size == 8 ? 144 : 112;
        IntPtr data = Marshal.AllocHGlobal(size);
        try {
            Marshal.Copy(new byte[size], 0, data, size);
            Marshal.WriteInt32(data, 16, 0x2000);
            if (h == IntPtr.Zero || !SetInformationJobObject(h, 9, data, (uint)size)) throw new Exception();
            return h;
        } finally { Marshal.FreeHGlobal(data); }
    }
    static string Quote(string value) {
        StringBuilder b = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            b.Append('\\', slashes * (c == '"' ? 2 : 1) + (c == '"' ? 1 : 0));
            b.Append(c); slashes = 0;
        }
        b.Append('\\', slashes * 2); return b.Append('"').ToString();
    }
    static Thread Pump(Stream input, Stream output, bool close) {
        var thread = new Thread(() => {
            try {
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
                    output.Write(buffer, 0, count); output.Flush();
                }
            } catch (IOException) {} catch (ObjectDisposedException) {}
            finally { if (close) output.Close(); }
        });
        thread.IsBackground = true; thread.Start(); return thread;
    }
    static Process Parent(Process process) {
        IntPtr[] info = new IntPtr[6]; int length;
        if (NtQueryInformationProcess(process.Handle, 0, info, info.Length * IntPtr.Size, out length) != 0) throw new Exception();
        return Process.GetProcessById(info[5].ToInt32());
    }
    static int Main(string[] args) {
        IntPtr job = IntPtr.Zero;
        string stage = "bootstrap";
        try {
            string root = Path.GetDirectoryName(Executable(Process.GetCurrentProcess()));
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "recovery.json")));
            stage = "parent";
            var directParent = Parent(Process.GetCurrentProcess());
            var parent = directParent;
            string owner = Environment.GetEnvironmentVariable("CODEX_SWITCH_OWNER");
            if (!String.IsNullOrEmpty(owner) && owner != parent.Id.ToString()) {
                parent = Parent(directParent);
                if (owner != parent.Id.ToString()) throw new Exception();
            }
            string expected = Environment.GetEnvironmentVariable("CODEX_SWITCH_EXPECTED_START");
            if (!String.IsNullOrEmpty(expected) && expected != parent.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()) throw new Exception();
            string command = (string)data["node"];
            // VS Code may have moved or updated since the launcher was deployed.
            // Query the executable image, not cross-architecture module memory.
            stage = "parent-executable";
            string current = Executable(parent);
            if (Path.GetFileName(current).Equals(Path.GetFileName(command), StringComparison.OrdinalIgnoreCase)) command = current;
            string arguments = Quote(Path.Combine(root, "recovery.js")) + " --launch " + parent.Id + " "
                + Quote(parent.StartTime.ToUniversalTime().ToFileTimeUtc().ToString());
            foreach (string arg in args) arguments += " " + Quote(arg);
            stage = "job";
            job = Job();
            // Enroll this bootstrap before starting children: descendants inherit
            // the job, with no race between starting and enrolling a child.
            if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) throw new Exception();
            // The IDE may kill its direct Node entry. Closing this job then
            // also closes every descendant's inherited protocol pipe.
            var watcher = new Thread(() => { try { directParent.WaitForExit(); } catch {} Environment.Exit(1); });
            watcher.IsBackground = true; watcher.Start();
            var start = new ProcessStartInfo(command, arguments);
            start.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
            start.EnvironmentVariables["CODEX_SWITCH_PARENT_CREATED"] = new DateTimeOffset(parent.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds().ToString();
            start.EnvironmentVariables.Remove("CODEX_SWITCH_OWNER");
            start.EnvironmentVariables.Remove("CODEX_SWITCH_EXPECTED_START");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            stage = "runtime";
            using (var child = Process.Start(start)) {
                Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream, true);
                var stdout = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
                var stderr = Pump(child.StandardError.BaseStream, Console.OpenStandardError(), false);
                child.WaitForExit(); stdout.Join(); stderr.Join(); return child.ExitCode;
            }
        } catch (Exception error) {
            Console.Error.WriteLine("Codex Switch could not start this window (" + stage + "/" + error.GetType().Name + "). Open Codex Switch to recover its configuration.");
            return 1;
        }
        // The OS closes the job handle when this process exits, including kills.
    }
}
