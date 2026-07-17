using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class WebGISLauncher
{
    [STAThread]
    private static void Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string webgisRoot = Path.Combine(root, "webgis");
        if (!Directory.Exists(webgisRoot))
        {
            MessageBox.Show("The webgis folder was not found. Please put this launcher in the project root folder.", "WebGIS launcher");
            return;
        }

        int port = FindAvailablePort(8020, 8099);
        LocalWebServer server = new LocalWebServer(webgisRoot, port);
        if (!server.Start())
        {
            MessageBox.Show("No available local port was found.", "WebGIS launcher");
            return;
        }

        OpenBrowser("http://127.0.0.1:" + port + "/");
        Application.EnableVisualStyles();
        Application.Run(new TrayContext(server, port));
    }

    private static int FindAvailablePort(int start, int end)
    {
        for (int port = start; port <= end; port++)
        {
            TcpListener test = null;
            try
            {
                test = new TcpListener(IPAddress.Parse("127.0.0.1"), port);
                test.Start();
                return port;
            }
            catch
            {
            }
            finally
            {
                if (test != null)
                {
                    test.Stop();
                }
            }
        }
        return -1;
    }

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo("cmd", "/c start \"\" \"" + url + "\"") { CreateNoWindow = true });
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly LocalWebServer server;
    private readonly NotifyIcon notifyIcon;
    private readonly int port;

    public TrayContext(LocalWebServer server, int port)
    {
        this.server = server;
        this.port = port;
        this.notifyIcon = new NotifyIcon();
        this.notifyIcon.Icon = System.Drawing.SystemIcons.Application;
        this.notifyIcon.Text = "WebGIS is running on " + port;
        this.notifyIcon.Visible = true;
        this.notifyIcon.ContextMenu = new ContextMenu(new MenuItem[]
        {
            new MenuItem("Open", delegate { Process.Start("http://127.0.0.1:" + this.port + "/"); }),
            new MenuItem("Exit", delegate { ExitThread(); })
        });
    }

    protected override void ExitThreadCore()
    {
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        server.Stop();
        base.ExitThreadCore();
    }
}

internal sealed class LocalWebServer
{
    private readonly string root;
    private readonly int port;
    private TcpListener listener;
    private volatile bool running;

    public LocalWebServer(string root, int port)
    {
        this.root = root;
        this.port = port;
    }

    public bool Start()
    {
        try
        {
            listener = new TcpListener(IPAddress.Parse("127.0.0.1"), port);
            listener.Start();
            running = true;
            Thread thread = new Thread(ListenLoop);
            thread.IsBackground = true;
            thread.Start();
            return true;
        }
        catch
        {
            return false;
        }
    }

    public void Stop()
    {
        running = false;
        try
        {
            if (listener != null)
            {
                listener.Stop();
            }
        }
        catch
        {
        }
    }

    private void ListenLoop()
    {
        while (running)
        {
            try
            {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate { HandleClient(client); });
            }
            catch
            {
                if (!running)
                {
                    return;
                }
            }
        }
    }

    private void HandleClient(TcpClient client)
    {
        try
        {
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                byte[] buffer = new byte[8192];
                int count = stream.Read(buffer, 0, buffer.Length);
                if (count <= 0)
                {
                    return;
                }

                int headerEnd = FindHeaderEnd(buffer, count);
                string request = Encoding.ASCII.GetString(buffer, 0, headerEnd >= 0 ? headerEnd : count);
                string firstLine = request.Split(new string[] { "\r\n" }, StringSplitOptions.None)[0];
                string[] parts = firstLine.Split(' ');
                if (parts.Length < 2)
                {
                    WriteResponse(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Bad request"));
                    return;
                }

                string method = parts[0];
                string urlPath = Uri.UnescapeDataString(parts[1].Split('?')[0]);
            if (method == "GET" && urlPath == "/api/health")
            {
                WriteResponse(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"));
                return;
            }

            if (method == "GET" && urlPath == "/api/version")
            {
                WriteResponse(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"version\":\"portable-csharp-20260717-http-baidu\"}"));
                return;
            }

                if (method == "POST" && urlPath == "/api/analyze")
                {
                    string requestBody = ReadRequestBody(stream, buffer, count, headerEnd, request);
                    string text = ExtractJsonString(requestBody, "text");
                    string region = ExtractJsonString(requestBody, "region");
                    string body = AnalyzeText(text, string.IsNullOrWhiteSpace(region) ? "浙江省" : region);
                    WriteResponse(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(body));
                    return;
                }

                if (method != "GET")
                {
                    WriteResponse(stream, 405, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Method not allowed"));
                    return;
                }

                if (urlPath == "/")
                {
                    urlPath = "/index.html";
                }

                string safeRelative = urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                string fullPath = Path.GetFullPath(Path.Combine(root, safeRelative));
                if (!fullPath.StartsWith(Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
                {
                    WriteResponse(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"));
                    return;
                }

                byte[] data = File.ReadAllBytes(fullPath);
                WriteResponse(stream, 200, GetContentType(fullPath), data);
            }
        }
        catch
        {
        }
    }

    private static int FindHeaderEnd(byte[] buffer, int count)
    {
        for (int i = 0; i <= count - 4; i++)
        {
            if (buffer[i] == 13 && buffer[i + 1] == 10 && buffer[i + 2] == 13 && buffer[i + 3] == 10)
            {
                return i;
            }
        }
        return -1;
    }

    private static int GetContentLength(string request)
    {
        Match match = Regex.Match(request, @"Content-Length:\s*(\d+)", RegexOptions.IgnoreCase);
        return match.Success ? int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
    }

    private static string ReadRequestBody(NetworkStream stream, byte[] firstBuffer, int firstCount, int headerEnd, string request)
    {
        int contentLength = GetContentLength(request);
        if (contentLength <= 0 || headerEnd < 0)
        {
            return "";
        }

        byte[] body = new byte[contentLength];
        int bodyOffset = headerEnd + 4;
        int alreadyRead = Math.Max(0, firstCount - bodyOffset);
        if (alreadyRead > 0)
        {
            Array.Copy(firstBuffer, bodyOffset, body, 0, Math.Min(alreadyRead, contentLength));
        }

        int totalRead = Math.Min(alreadyRead, contentLength);
        while (totalRead < contentLength)
        {
            int read = stream.Read(body, totalRead, contentLength - totalRead);
            if (read <= 0)
            {
                break;
            }
            totalRead += read;
        }

        return Encoding.UTF8.GetString(body, 0, totalRead);
    }

    private static string GetContentType(string path)
    {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext == ".html") return "text/html; charset=utf-8";
        if (ext == ".js") return "text/javascript; charset=utf-8";
        if (ext == ".css") return "text/css; charset=utf-8";
        if (ext == ".geojson") return "application/geo+json; charset=utf-8";
        if (ext == ".json") return "application/json; charset=utf-8";
        if (ext == ".png") return "image/png";
        if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
        return "application/octet-stream";
    }

    private string AnalyzeText(string text, string region)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return "{\"ok\":false,\"error\":\"请输入投诉文本\"}";
        }

        ClassifyResult classify = ClassifyComplaint(text);
        string address = ExtractAddress(text);
        string queryAddress = BuildQueryAddress(region, address);
        GeoResult geo = Geocode(queryAddress);

        StringBuilder json = new StringBuilder();
        json.Append("{\"ok\":true,\"result\":{");
        AppendJson(json, "事项编号", "临时识别", true);
        AppendJson(json, "诉求内容", text, true);
        AppendJson(json, "问题属地", region, true);
        AppendJson(json, "噪声分类", classify.Type, true);
        AppendJson(json, "噪声分类命中关键词", string.Join(",", classify.Keywords), true);
        AppendJson(json, "识别地址", address, true);
        AppendJson(json, "地址识别状态", string.IsNullOrEmpty(address) ? "未找到地址" : "命中截止词", true);
        AppendJson(json, "百度地理编码地址", queryAddress, true);
        AppendJson(json, "百度地理编码状态", geo.Status, true);
        AppendJson(json, "百度地理编码消息", geo.Message, true);
        AppendJson(json, "坐标转换状态", geo.Ok ? "launcher_formula" : "跳过", true);
        AppendJson(json, "坐标转换消息", geo.Ok ? "启动器内置公式已转换为 GCJ-02" : "未获得有效坐标", true);
        if (geo.Ok)
        {
            double[] gcj = Bd09ToGcj02(geo.Lng, geo.Lat);
            AppendJson(json, "百度经度", geo.Lng.ToString(CultureInfo.InvariantCulture), false);
            AppendJson(json, "百度纬度", geo.Lat.ToString(CultureInfo.InvariantCulture), false);
            AppendJson(json, "GCJ02经度", gcj[0].ToString(CultureInfo.InvariantCulture), false);
            AppendJson(json, "GCJ02纬度", gcj[1].ToString(CultureInfo.InvariantCulture), false);
        }
        AppendJson(json, "isHighlight", "true", false);
        json.Append("}}");
        return json.ToString();
    }

    private ClassifyResult ClassifyComplaint(string text)
    {
        string keywordPath = Path.Combine(root, "data", "noise_keywords.tsv");
        string selectedType = "未匹配";
        string[] selectedKeywords = new string[0];
        string[] tiedTypes = new string[0];

        if (!File.Exists(keywordPath))
        {
            return new ClassifyResult(selectedType, selectedKeywords);
        }

        int maxCount = 0;
        foreach (string line in File.ReadAllLines(keywordPath, Encoding.UTF8))
        {
            string[] parts = line.Split(new char[] { '\t' }, 2);
            if (parts.Length != 2) continue;
            string type = parts[0];
            string[] keywords = parts[1].Split('|');
            System.Collections.Generic.List<string> hits = new System.Collections.Generic.List<string>();
            foreach (string keyword in keywords)
            {
                if (!string.IsNullOrEmpty(keyword) && text.Contains(keyword) && !hits.Contains(keyword))
                {
                    hits.Add(keyword);
                }
            }
            if (hits.Count > maxCount)
            {
                maxCount = hits.Count;
                selectedType = type;
                selectedKeywords = hits.ToArray();
            }
        }

        return new ClassifyResult(selectedType, selectedKeywords);
    }

    private static string ExtractAddress(string text)
    {
        string content = Regex.Replace(text ?? "", "\\s+", "");
        Match start = Regex.Match(content, @"(?:[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|街道)|[\u4e00-\u9fa5A-Za-z0-9·\-]{2,}(?:路|街|巷|弄|大道)|[\u4e00-\u9fa5A-Za-z0-9·\-]{2,}(?:社区|小区|村|园|苑|府|城|大厦|广场|中心|公司|工厂|厂))");
        if (!start.Success) return "";
        string candidate = content.Substring(start.Index, Math.Min(100, content.Length - start.Index));
        candidate = Regex.Replace(candidate, @"^[0-9:：\-.年月日]+", "");
        candidate = Regex.Replace(candidate, @"^(来电反映|市民反映|群众反映|现来电反映|其表示|其是|反映|地址为|位于|在|至)", "");

        string[] stopWords = new string[] { "门牌号", "号楼", "东门", "西门", "南门", "北门", "小区", "社区", "大厦", "广场", "中心", "公司", "工厂", "厂房", "学校", "医院", "市场", "商场", "酒店", "公寓", "写字楼", "停车场", "幢", "栋", "号", "门", "园", "苑", "府", "城", "村", "厂" };
        int bestEnd = -1;
        foreach (string word in stopWords)
        {
            int index = candidate.IndexOf(word, StringComparison.Ordinal);
            if (index >= 0 && (bestEnd < 0 || index < bestEnd))
            {
                bestEnd = index + word.Length;
            }
        }
        if (bestEnd > 0)
        {
            return candidate.Substring(0, bestEnd).Trim('，', ',', '。', '；', ';', '：', ':', '（', '）', '(', ')');
        }

        Match fallback = Regex.Match(candidate, @"[，,。；;：:\n\r]|附近|旁边|隔壁|对面|每天|产生|存在|进行|发出|影响|要求|希望|反映");
        if (fallback.Success)
        {
            return candidate.Substring(0, fallback.Index).Trim('，', ',', '。', '；', ';', '：', ':', '（', '）', '(', ')');
        }
        return candidate.Length > 40 ? candidate.Substring(0, 40) : candidate;
    }

    private static string BuildQueryAddress(string region, string address)
    {
        if (string.IsNullOrWhiteSpace(address)) return region;
        if (!string.IsNullOrWhiteSpace(region) && !address.Contains(region)) return region + address;
        return address;
    }

    private static GeoResult Geocode(string address)
    {
        try
        {
            string ak = "ZqdaxnNveaYhhyiHR4TqcZY3b3ZxpecO";
            string url = "http://api.map.baidu.com/geocoding/v3/?output=json&ak=" + Uri.EscapeDataString(ak) + "&address=" + Uri.EscapeDataString(address);
            using (WebClient client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                string json = client.DownloadString(url);
                Match statusMatch = Regex.Match(json, @"""status""\s*:\s*(\d+)");
                string status = statusMatch.Success ? statusMatch.Groups[1].Value : "ERROR";
                if (status != "0") return new GeoResult(false, 0, 0, status, "百度地理编码失败");
                Match lngMatch = Regex.Match(json, @"""lng""\s*:\s*([0-9.\-]+)");
                Match latMatch = Regex.Match(json, @"""lat""\s*:\s*([0-9.\-]+)");
                if (!lngMatch.Success || !latMatch.Success) return new GeoResult(false, 0, 0, "ERROR", "未返回经纬度");
                return new GeoResult(true, double.Parse(lngMatch.Groups[1].Value, CultureInfo.InvariantCulture), double.Parse(latMatch.Groups[1].Value, CultureInfo.InvariantCulture), "0", "OK");
            }
        }
        catch (Exception ex)
        {
            return new GeoResult(false, 0, 0, "ERROR", ex.Message);
        }
    }

    private static double[] Bd09ToGcj02(double lng, double lat)
    {
        double x = lng - 0.0065;
        double y = lat - 0.006;
        double xPi = Math.PI * 3000.0 / 180.0;
        double z = Math.Sqrt(x * x + y * y) - 0.00002 * Math.Sin(y * xPi);
        double theta = Math.Atan2(y, x) - 0.000003 * Math.Cos(x * xPi);
        return new double[] { z * Math.Cos(theta), z * Math.Sin(theta) };
    }

    private static string ExtractJsonString(string json, string key)
    {
        Match match = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
        if (!match.Success) return "";
        return Regex.Unescape(match.Groups[1].Value);
    }

    private static void AppendJson(StringBuilder builder, string key, string value, bool quoteValue)
    {
        if (builder[builder.Length - 1] != '{') builder.Append(',');
        builder.Append('"').Append(JsonEscape(key)).Append('"').Append(':');
        if (quoteValue) builder.Append('"').Append(JsonEscape(value ?? "")).Append('"');
        else builder.Append(value ?? "null");
    }

    private static string JsonEscape(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body)
    {
        string statusText = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed" : status == 501 ? "Not Implemented" : "Error";
        string header = "HTTP/1.1 " + status + " " + statusText + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            "Connection: close\r\n\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
        stream.Write(headerBytes, 0, headerBytes.Length);
        stream.Write(body, 0, body.Length);
    }
}

internal sealed class ClassifyResult
{
    public readonly string Type;
    public readonly string[] Keywords;
    public ClassifyResult(string type, string[] keywords)
    {
        Type = type;
        Keywords = keywords;
    }
}

internal sealed class GeoResult
{
    public readonly bool Ok;
    public readonly double Lng;
    public readonly double Lat;
    public readonly string Status;
    public readonly string Message;
    public GeoResult(bool ok, double lng, double lat, string status, string message)
    {
        Ok = ok;
        Lng = lng;
        Lat = lat;
        Status = status;
        Message = message;
    }
}
