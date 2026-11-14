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
    static string Binding() {
        string direct = Environment.GetEnvironmentVariable("CODEX_SWITCH_BINDING");
        IntPtr[] info = new IntPtr[6]; int length;
        if (NtQueryInformationProcess(Process.GetCurrentProcess().Handle, 0, info, info.Length * IntPtr.Size, out length) != 0) throw new Exception();
        int parent = info[5].ToInt32();
        string owner = Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName), "owners", parent + ".json");
        for (int i = 0; i < 300; i++) {
            if (!String.IsNullOrEmpty(direct) && File.Exists(direct)) return direct;
            if (String.IsNullOrEmpty(direct) && File.Exists(owner)) {
                try {
                    var record = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(owner));
                    string started = Process.GetProcessById(parent).StartTime.ToUniversalTime().ToFileTimeUtc().ToString();
                    if ((string)record["ownerStart"] == started && File.Exists((string)record["binding"])) return (string)record["binding"];
                } catch (IOException) {} catch (KeyNotFoundException) {}
            }
            Thread.Sleep(100);
        }
        throw new Exception();
    }
    static int Main(string[] args) {
        IntPtr job = IntPtr.Zero;
        try {
            string binding = Binding();
            var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(binding));
            string command = (string)data["python"];
            string arguments = Quote((string)data["launcher"]) + " " + Quote(binding);
            foreach (string arg in args) arguments += " " + Quote(arg);
            job = Job();
            // Enroll this bootstrap before starting children: descendants inherit
            // the job, with no race between starting and enrolling a child.
            if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle)) throw new Exception();
            var start = new ProcessStartInfo(command, arguments);
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            using (var child = Process.Start(start)) {
                Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream, true);
                var stdout = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), false);
                var stderr = Pump(child.StandardError.BaseStream, Console.OpenStandardError(), false);
                child.WaitForExit(); stdout.Join(); stderr.Join(); return child.ExitCode;
            }
        } catch {
            Console.Error.WriteLine("Codex Switch could not start this window. Open Codex Switch to recover its configuration.");
            return 1;
        }
        // The OS closes the job handle when this process exits, including kills.
    }
}
