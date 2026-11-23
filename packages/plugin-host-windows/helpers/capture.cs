// The Windows Host Adapter's capture helper: captures one window to an image with
// Windows.Graphics.Capture, which keeps getting the window's own frames while other windows cover
// it (PrintWindow doesn't, for the game). Compiled on first use by helpers.ts with the in-box .NET
// Framework csc.exe, against the WinRT metadata in System32\WinMetadata.
//
//   capture <hwnd> <output> <png|jpeg>              writes the window's next frame; prints its size, "<width>x<height>"
//   frame <hwnd> <output> <quality 1-100> <width>   a capture tour's frame: the window's client area only (no title
//                                                   bar or borders), scaled down so neither side is over <width>, as
//                                                   JPEG at that quality; prints its size
//
// Exits 3 when there's no such window, 4 when no frame came within 5 s, and 5 when the window is
// minimized, since a minimized window gives no frames. Per-monitor DPI aware, so it captures in
// physical pixels on a scaled display.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;

[ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IGraphicsCaptureItemInterop {
  IntPtr CreateForWindow(IntPtr window, [In] ref Guid iid);
  IntPtr CreateForMonitor(IntPtr monitor, [In] ref Guid iid);
}

[ComImport, Guid("5B0D3235-4DBA-4D44-865E-8F1D0E4FD04D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
unsafe interface IMemoryBufferByteAccess { void GetBuffer(out byte* buffer, out uint capacity); }

static unsafe class Capture {
  [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr levels, uint levelCount, uint sdkVersion, out IntPtr device, out int level, out IntPtr context);
  [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out WindowRect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref System.Drawing.Point point);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out WindowRect rect, int size);

  [StructLayout(LayoutKind.Sequential)] struct WindowRect { public int Left, Top, Right, Bottom; }

  const int D3D_DRIVER_TYPE_HARDWARE = 1;
  const int D3D_DRIVER_TYPE_WARP = 5;
  const uint D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20;
  const uint D3D11_SDK_VERSION = 7;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  static readonly Guid IID_IDXGIDevice = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
  static readonly Guid IID_IGraphicsCaptureItem = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");

  /** Waits up to 10 s for a WinRT operation, so a lost device can't leave the helper running. */
  static T Wait<T>(IAsyncOperation<T> operation) {
    var end = DateTime.UtcNow.AddSeconds(10);
    while (operation.Status == AsyncStatus.Started) {
      if (DateTime.UtcNow >= end) { operation.Cancel(); throw new Exception("copying the frame took over 10 s"); }
      Thread.Sleep(10);
    }
    return operation.GetResults();
  }

  /** A Direct3D device for the frame pool: the GPU's, else WARP's (software) when there's no usable GPU. */
  static IDirect3DDevice Device() {
    IntPtr device, context;
    int level;
    int result = D3D11CreateDevice(IntPtr.Zero, D3D_DRIVER_TYPE_HARDWARE, IntPtr.Zero, D3D11_CREATE_DEVICE_BGRA_SUPPORT, IntPtr.Zero, 0, D3D11_SDK_VERSION, out device, out level, out context);
    if (result < 0) result = D3D11CreateDevice(IntPtr.Zero, D3D_DRIVER_TYPE_WARP, IntPtr.Zero, D3D11_CREATE_DEVICE_BGRA_SUPPORT, IntPtr.Zero, 0, D3D11_SDK_VERSION, out device, out level, out context);
    if (result < 0) throw new Exception("couldn't create a Direct3D 11 device (0x" + result.ToString("X8") + ")");
    Guid iid = IID_IDXGIDevice;
    IntPtr dxgi;
    Marshal.QueryInterface(device, ref iid, out dxgi);
    IntPtr inspectable;
    result = CreateDirect3D11DeviceFromDXGIDevice(dxgi, out inspectable);
    Marshal.Release(dxgi);
    Marshal.Release(context);
    Marshal.Release(device);
    if (result < 0) throw new Exception("couldn't wrap the Direct3D device for capture (0x" + result.ToString("X8") + ")");
    var wrapped = (IDirect3DDevice)Marshal.GetObjectForIUnknown(inspectable);
    Marshal.Release(inspectable);
    return wrapped;
  }

  static GraphicsCaptureItem ItemFor(IntPtr hwnd) {
    var interop = (IGraphicsCaptureItemInterop)WindowsRuntimeMarshal.GetActivationFactory(typeof(GraphicsCaptureItem));
    Guid iid = IID_IGraphicsCaptureItem;
    IntPtr pointer = interop.CreateForWindow(hwnd, ref iid);
    var item = (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(pointer);
    Marshal.Release(pointer);
    return item;
  }

  static ImageCodecInfo Encoder(ImageFormat format) {
    foreach (var codec in ImageCodecInfo.GetImageEncoders()) if (codec.FormatID == format.Guid) return codec;
    throw new Exception("no " + format + " encoder");
  }

  /** How a frame is saved: the part of it kept, the most either side may be, and the format. */
  struct Output { public Rectangle Crop; public int MaxSide; public long Quality; public bool Jpeg; }

  /**
   * The window's client area within its captured frame. Windows.Graphics.Capture captures a window's
   * visible frame (its extended frame bounds, without the drop shadow), title bar and borders
   * included; the client area is the game's picture. Without those bounds the whole frame is kept:
   * GetWindowRect's rectangle takes in the invisible resize borders too, so it would misplace the crop.
   */
  static Rectangle ClientArea(IntPtr hwnd, int width, int height) {
    var all = new Rectangle(0, 0, width, height);
    WindowRect frame;
    if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out frame, Marshal.SizeOf(typeof(WindowRect))) != 0) return all;
    WindowRect client;
    var origin = new System.Drawing.Point(0, 0);
    if (!GetClientRect(hwnd, out client) || !ClientToScreen(hwnd, ref origin)) return all;
    var area = new Rectangle(origin.X - frame.Left, origin.Y - frame.Top, client.Right - client.Left, client.Bottom - client.Top);
    area.Intersect(all);
    return area.Width > 0 && area.Height > 0 ? area : all;
  }

  /**
   * Saves the frame. Its BGRA pixels are read in place as 32-bit RGB, so the window's alpha is
   * ignored and the image is opaque. A crop or a scale is drawn into a new bitmap with high-quality
   * bicubic filtering, and never enlarges.
   */
  static void Save(Direct3D11CaptureFrame frame, string path, Func<int, int, Output> how, out int width, out int height) {
    using (var copy = Wait(SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Ignore)))
    using (var buffer = copy.LockBuffer(BitmapBufferAccessMode.Read))
    using (var reference = buffer.CreateReference()) {
      var plane = buffer.GetPlaneDescription(0);
      byte* pixels;
      uint capacity;
      ((IMemoryBufferByteAccess)reference).GetBuffer(out pixels, out capacity);
      var output = how(copy.PixelWidth, copy.PixelHeight);
      var crop = output.Crop;
      var scale = Math.Min(1.0, (double)output.MaxSide / Math.Max(crop.Width, crop.Height));
      width = Math.Max(1, (int)Math.Round(crop.Width * scale));
      height = Math.Max(1, (int)Math.Round(crop.Height * scale));
      using (var bitmap = new Bitmap(copy.PixelWidth, copy.PixelHeight, plane.Stride, PixelFormat.Format32bppRgb, new IntPtr(pixels + plane.StartIndex))) {
        var whole = crop.X == 0 && crop.Y == 0 && crop.Width == copy.PixelWidth && crop.Height == copy.PixelHeight && width == crop.Width;
        using (var result = whole ? null : new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
          if (result != null) {
            using (var graphics = Graphics.FromImage(result))
            using (var edges = new ImageAttributes()) {
              graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
              graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
              graphics.CompositingMode = CompositingMode.SourceCopy;
              // Mirrored at the edges, so the filter doesn't blend a dark border into the picture.
              edges.SetWrapMode(WrapMode.TileFlipXY);
              graphics.DrawImage(bitmap, new Rectangle(0, 0, width, height), crop.X, crop.Y, crop.Width, crop.Height, GraphicsUnit.Pixel, edges);
            }
          }
          var image = result ?? bitmap;
          if (output.Jpeg) {
            var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, output.Quality);
            image.Save(path, Encoder(ImageFormat.Jpeg), parameters);
          } else {
            image.Save(path, ImageFormat.Png);
          }
        }
      }
    }
  }

  /** Sets a session's boolean property to false when this Windows has it. */
  static void TurnOff(GraphicsCaptureSession session, string property) {
    var setting = typeof(GraphicsCaptureSession).GetProperty(property);
    if (setting == null || !setting.CanWrite) return;
    try { setting.SetValue(session, false, null); } catch (Exception) { }
  }

  static int Run(IntPtr hwnd, string path, Func<int, int, Output> how) {
    if (!IsWindow(hwnd)) { Console.Error.WriteLine("no window " + hwnd); return 3; }
    if (IsIconic(hwnd)) { Console.Error.WriteLine("the window is minimized"); return 5; }
    if (!GraphicsCaptureSession.IsSupported()) throw new Exception("Windows.Graphics.Capture isn't supported on this system");
    var item = ItemFor(hwnd);
    var device = Device();
    using (var pool = Direct3D11CaptureFramePool.CreateFreeThreaded(device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, item.Size))
    using (var session = pool.CreateCaptureSession(item)) {
      // Set by name: Windows 10's metadata lacks IsBorderRequired (Windows 11) and, before 2004,
      // IsCursorCaptureEnabled, so naming them in code would stop the helper compiling there.
      TurnOff(session, "IsCursorCaptureEnabled");
      TurnOff(session, "IsBorderRequired");
      session.StartCapture();
      // Up to 5 s for a first frame. A window sends another only when it changes, so a moving one
      // (the game) gives a second within moments; a still one (an idle Editor) is taken as it was.
      Direct3D11CaptureFrame frame = null;
      var end = DateTime.UtcNow.AddSeconds(5);
      while (DateTime.UtcNow < end) {
        var next = pool.TryGetNextFrame();
        if (next == null) { Thread.Sleep(10); continue; }
        if (frame != null) { frame.Dispose(); frame = next; break; }
        frame = next;
        end = DateTime.UtcNow.AddMilliseconds(500);
      }
      if (frame == null) { Console.Error.WriteLine("no frame from the window within 5 s"); return 4; }
      int width, height;
      using (frame) Save(frame, path, how, out width, out height);
      Console.WriteLine(width + "x" + height);
    }
    return 0;
  }

  static int Main(string[] args) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    Console.OutputEncoding = new UTF8Encoding(false);
    int quality, side;
    try {
      if (args.Length == 4 && args[0] == "capture" && (args[3] == "png" || args[3] == "jpeg")) {
        var jpeg = args[3] == "jpeg";
        return Run(new IntPtr(long.Parse(args[1])), args[2], (width, height) => new Output { Crop = new Rectangle(0, 0, width, height), MaxSide = int.MaxValue, Quality = 90, Jpeg = jpeg });
      }
      if (args.Length == 5 && args[0] == "frame" && int.TryParse(args[3], out quality) && quality >= 1 && quality <= 100 && int.TryParse(args[4], out side) && side > 0) {
        var hwnd = new IntPtr(long.Parse(args[1]));
        return Run(hwnd, args[2], (width, height) => new Output { Crop = ClientArea(hwnd, width, height), MaxSide = side, Quality = quality, Jpeg = true });
      }
    } catch (Exception error) {
      Console.Error.WriteLine(error.Message);
      return 1;
    }
    Console.Error.WriteLine("usage: capture capture <hwnd> <output> <png|jpeg> | frame <hwnd> <output> <quality 1-100> <width>");
    return 2;
  }
}
