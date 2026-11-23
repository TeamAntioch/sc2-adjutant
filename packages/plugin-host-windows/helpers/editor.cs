// The Windows Host Adapter's Editor helper: lists top-level windows, posts menu commands and clicks
// dialog buttons. Compiled on first use by helpers.ts with the in-box .NET Framework csc.exe.
//
//   editor windows             one line per top-level window: hwnd, owner hwnd, pid, process, class, visible (1/0), has a menu (1/0), title (tab-separated)
//   editor menu <hwnd>         one line per item of the window's menus, one level down: menu, command id, checked (1/0), label, shortcut
//   editor pids <name>...      the ids of the running processes with those names (no ".exe"), one per line
//   editor post <hwnd> <id>    posts WM_COMMAND <id> to the window, as choosing that menu item does
//   editor buttons <hwnd>      one line per child button: hwnd, enabled (1/0), text (tab-separated); then "text" lines for its static text
//   editor click <hwnd>        clicks the button (BN_CLICKED to its dialog), without bringing anything forward
//   editor documents           the Documents folder, wherever the shell has it (it may be redirected)
//   editor restore <hwnd>      restores the window if it's minimized, without activating it; prints "restored" if it was
//   editor space <hwnd>        brings the window forward and presses Space in it
//   editor awake <pid>         keeps the display and the system awake until that process exits, or this one is stopped
//
// Per-monitor DPI aware, so window sizes read in physical pixels on a scaled display.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

static class Editor {
  delegate bool EnumProc(IntPtr hwnd, IntPtr param);

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr param);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int position);
  [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu, int position);
  [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr menu, uint item, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int max, uint flags);

  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint to, bool on);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);

  [StructLayout(LayoutKind.Sequential)]
  struct KeyboardInput { public ushort Vk; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)]
  struct MouseInput { public int Dx; public int Dy; public uint Data; public uint Flags; public uint Time; public IntPtr Extra; }
  // INPUT holds a union as big as MOUSEINPUT, its largest member; SendInput refuses another size.
  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Key; }
  [StructLayout(LayoutKind.Sequential)]
  struct Input { public uint Type; public InputUnion Union; }

  const int SW_SHOWNOACTIVATE = 4;
  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const ushort VK_SPACE = 0x20;
  const uint ES_CONTINUOUS = 0x80000000;
  const uint ES_SYSTEM_REQUIRED = 0x00000001;
  const uint ES_DISPLAY_REQUIRED = 0x00000002;
  const uint GW_OWNER = 4;
  const uint WM_COMMAND = 0x0111;
  const uint WM_GETTEXT = 0x000D;
  const uint BM_CLICK = 0x00F5;
  const uint SMTO_ABORTIFHUNG = 0x0002;
  const uint MF_BYPOSITION = 0x0400;
  const uint MF_CHECKED = 0x0008;

  static string Clean(string text) {
    return text.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
  }

  static string Text(IntPtr hwnd) {
    var text = new StringBuilder(2048);
    GetWindowText(hwnd, text, text.Capacity);
    return Clean(text.ToString());
  }

  /** A child control's text, asked of it with a timeout: GetWindowText doesn't read another process's controls. */
  static string ControlText(IntPtr hwnd) {
    var text = new StringBuilder(2048);
    IntPtr result;
    SendMessageTimeout(hwnd, WM_GETTEXT, (IntPtr)text.Capacity, text, SMTO_ABORTIFHUNG, 2000, out result);
    return Clean(text.ToString());
  }

  static string ClassName(IntPtr hwnd) {
    var name = new StringBuilder(256);
    GetClassName(hwnd, name, name.Capacity);
    return name.ToString();
  }

  static IntPtr Handle(string text) {
    return new IntPtr(long.Parse(text));
  }

  static int Windows() {
    var names = new Dictionary<uint, string>();
    var lines = new List<string>();
    EnumWindows((hwnd, param) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      string name;
      if (!names.TryGetValue(pid, out name)) {
        try { name = Process.GetProcessById((int)pid).ProcessName; } catch { name = ""; }
        names[pid] = name;
      }
      lines.Add(string.Join("\t", new[] {
        hwnd.ToInt64().ToString(), GetWindow(hwnd, GW_OWNER).ToInt64().ToString(), pid.ToString(), name,
        ClassName(hwnd), IsWindowVisible(hwnd) ? "1" : "0", GetMenu(hwnd) != IntPtr.Zero ? "1" : "0", Text(hwnd),
      }));
      return true;
    }, IntPtr.Zero);
    foreach (var line in lines) Console.WriteLine(line);
    return 0;
  }

  static int Pids(string[] names) {
    foreach (var name in names) foreach (var process in Process.GetProcessesByName(name)) Console.WriteLine(process.Id);
    return 0;
  }

  static int Menu(IntPtr hwnd) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 2; }
    var menu = GetMenu(hwnd);
    if (menu == IntPtr.Zero) return 0;
    for (int top = 0; top < GetMenuItemCount(menu); top++) {
      var submenu = GetSubMenu(menu, top);
      if (submenu == IntPtr.Zero) continue;
      var heading = Clean(RawMenuText(menu, (uint)top));
      for (int item = 0; item < GetMenuItemCount(submenu); item++) {
        // A label and its shortcut are separated by a tab: "&Save\tCtrl+S".
        var text = RawMenuText(submenu, (uint)item);
        if (text.Length == 0) continue;
        var tab = text.IndexOf('\t');
        var label = Clean(tab < 0 ? text : text.Substring(0, tab));
        var shortcut = tab < 0 ? "" : Clean(text.Substring(tab + 1));
        var state = GetMenuState(submenu, (uint)item, MF_BYPOSITION);
        Console.WriteLine(heading + "\t" + (int)GetMenuItemID(submenu, item) + "\t" + ((state & MF_CHECKED) != 0 ? "1" : "0") + "\t" + label + "\t" + shortcut);
      }
    }
    return 0;
  }

  static string RawMenuText(IntPtr menu, uint position) {
    var text = new StringBuilder(1024);
    GetMenuString(menu, position, text, text.Capacity, MF_BYPOSITION);
    return text.ToString();
  }

  static int Post(IntPtr hwnd, int id) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 2; }
    return PostMessage(hwnd, WM_COMMAND, (IntPtr)id, IntPtr.Zero) ? 0 : 1;
  }

  static int Buttons(IntPtr hwnd) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 2; }
    var buttons = new List<string>();
    var texts = new List<string>();
    EnumChildWindows(hwnd, (child, param) => {
      var kind = ClassName(child);
      if (kind == "Button") buttons.Add(child.ToInt64() + "\t" + (IsWindowEnabled(child) ? "1" : "0") + "\t" + ControlText(child));
      else if (kind == "Static" && IsWindowVisible(child)) {
        var text = ControlText(child);
        if (text.Length > 0) texts.Add("text\t" + text);
      }
      return true;
    }, IntPtr.Zero);
    foreach (var line in buttons) Console.WriteLine(line);
    foreach (var line in texts) Console.WriteLine(line);
    return 0;
  }

  // The button's BN_CLICKED, posted to its dialog as WM_COMMAND, which is what a click sends. BM_CLICK
  // can be dropped by a dialog that isn't the active window; this works whatever is in front.
  static int Click(IntPtr hwnd) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 2; }
    var dialog = GetParent(hwnd);
    var id = GetDlgCtrlID(hwnd);
    if (dialog == IntPtr.Zero || id == 0) return PostMessage(hwnd, BM_CLICK, IntPtr.Zero, IntPtr.Zero) ? 0 : 1;
    return PostMessage(dialog, WM_COMMAND, (IntPtr)(id & 0xFFFF), hwnd) ? 0 : 1;
  }

  static int Documents() {
    Console.WriteLine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
    return 0;
  }

  /** A minimized window gives no frames to capture, so it's shown again, left behind whatever covers it. */
  static int Restore(IntPtr hwnd) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 2; }
    if (!IsIconic(hwnd)) return 0;
    ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE);
    var end = DateTime.UtcNow.AddSeconds(3);
    while (IsIconic(hwnd) && DateTime.UtcNow < end) System.Threading.Thread.Sleep(50);
    if (IsIconic(hwnd)) { Console.Error.WriteLine("the window is still minimized"); return 1; }
    Console.WriteLine("restored");
    return 0;
  }

  /**
   * Brings the window forward and presses Space, for a loading screen that waits for it. Windows lets
   * a background process take the foreground only while its input is attached to the foreground
   * window's thread.
   */
  static int Space(IntPtr hwnd) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 2; }
    if (IsIconic(hwnd)) ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE);
    var foreground = GetForegroundWindow();
    uint ignored;
    var theirs = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
    var mine = GetCurrentThreadId();
    var attached = theirs != 0 && theirs != mine && AttachThreadInput(mine, theirs, true);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (attached) AttachThreadInput(mine, theirs, false);
    System.Threading.Thread.Sleep(300);
    if (GetForegroundWindow() != hwnd) { Console.Error.WriteLine("couldn't bring the window forward to press Space"); return 1; }
    var size = Marshal.SizeOf(typeof(Input));
    // With its scan code too, for a game that reads keys by scan code.
    var scan = (ushort)MapVirtualKey(VK_SPACE, 0);
    var inputs = new[] {
      new Input { Type = INPUT_KEYBOARD, Union = new InputUnion { Key = new KeyboardInput { Vk = VK_SPACE, Scan = scan } } },
      new Input { Type = INPUT_KEYBOARD, Union = new InputUnion { Key = new KeyboardInput { Vk = VK_SPACE, Scan = scan, Flags = KEYEVENTF_KEYUP } } },
    };
    return SendInput((uint)inputs.Length, inputs, size) == inputs.Length ? 0 : 1;
  }

  /** Keeps the display on and the system awake while the process runs, as `caffeinate -d -w <pid>` does on the Mac. */
  static int Awake(int pid) {
    SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
    try { Process.GetProcessById(pid).WaitForExit(); } catch (ArgumentException) { }
    return 0;
  }

  static int Main(string[] args) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    Console.OutputEncoding = new UTF8Encoding(false);
    var command = args.Length > 0 ? args[0] : "";
    try {
      if (command == "windows" && args.Length == 1) return Windows();
      if (command == "pids" && args.Length >= 2) { var names = new string[args.Length - 1]; Array.Copy(args, 1, names, 0, names.Length); return Pids(names); }
      if (command == "menu" && args.Length == 2) return Menu(Handle(args[1]));
      if (command == "post" && args.Length == 3) return Post(Handle(args[1]), int.Parse(args[2]));
      if (command == "buttons" && args.Length == 2) return Buttons(Handle(args[1]));
      if (command == "click" && args.Length == 2) return Click(Handle(args[1]));
      if (command == "documents" && args.Length == 1) return Documents();
      if (command == "restore" && args.Length == 2) return Restore(Handle(args[1]));
      if (command == "space" && args.Length == 2) return Space(Handle(args[1]));
      if (command == "awake" && args.Length == 2) return Awake(int.Parse(args[1]));
    } catch (FormatException error) {
      Console.Error.WriteLine(error.Message);
      return 2;
    }
    Console.Error.WriteLine("usage: editor windows | pids <name>... | menu <hwnd> | post <hwnd> <id> | buttons <hwnd> | click <hwnd> | documents | restore <hwnd> | space <hwnd> | awake <pid>");
    return 2;
  }
}
