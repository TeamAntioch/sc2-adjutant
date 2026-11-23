// The Windows Host Adapter's speech helper: speaks a line with Windows' built-in voices
// (System.Speech, the desktop SAPI voices) straight to a WAV in the format SC2 plays. Compiled on
// first use by helpers.ts with the in-box .NET Framework csc.exe, against the framework's
// WPF\System.Speech.dll.
//
//   voices                        prints each enabled voice, "<name>\t<culture>\t<gender>", one a line
//   speak <voice> <text> <output>  speaks the UTF-8 text file <text> in <voice> ("-": the default
//                                  voice) to <output>, a 22050 Hz, 16-bit, mono PCM WAV
//
// The text comes from a file, not the command line, so a long line or one with quotes is passed whole.
// The voice is named in full, as `voices` lists it: speech-windows.ts picks it.
using System;
using System.IO;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;
using System.Text;

static class Speech {
  static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    try {
      if (args.Length == 1 && args[0] == "voices") {
        using (var synthesizer = new SpeechSynthesizer()) {
          foreach (var voice in synthesizer.GetInstalledVoices()) {
            if (!voice.Enabled) continue;
            var info = voice.VoiceInfo;
            Console.WriteLine(info.Name + "\t" + info.Culture.Name + "\t" + info.Gender);
          }
        }
        return 0;
      }
      if (args.Length == 4 && args[0] == "speak") {
        var text = File.ReadAllText(args[2], Encoding.UTF8);
        using (var synthesizer = new SpeechSynthesizer()) {
          if (args[1] != "-") synthesizer.SelectVoice(args[1]);
          synthesizer.SetOutputToWaveFile(args[3], new SpeechAudioFormatInfo(22050, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
          synthesizer.Speak(text);
          // Closes the file, writing the WAV header's sizes.
          synthesizer.SetOutputToNull();
        }
        return 0;
      }
    } catch (Exception error) {
      Console.Error.WriteLine(error.Message);
      return 1;
    }
    Console.Error.WriteLine("usage: speech voices | speech speak <voice> <text file> <output.wav>");
    return 2;
  }
}
