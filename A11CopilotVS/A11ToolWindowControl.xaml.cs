using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;

namespace A11CopilotVS
{
    public partial class A11ToolWindowControl : UserControl
    {
        private static readonly HttpClient _http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(60)
        };

        private const string A11Endpoint = "http://127.0.0.1:3000/v1/chat/completions";
        private const string A11Model = "a11-phi3"; // adapte si besoin

        public A11ToolWindowControl()
        {
            InitializeComponent();
        }

        [System.Diagnostics.CodeAnalysis.SuppressMessage("Usage", "VSTHRD100:Avoid async void methods", Justification = "Event handler with proper exception handling")]
        private async void SendButton_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                var prompt = PromptBox.Text.Trim();
                if (string.IsNullOrEmpty(prompt)) return;

                AppendMessage("Toi", prompt);
                PromptBox.Clear();

                var body = new
                {
                    model = A11Model,
                    messages = new[]
                    {
                        new { role = "system", content = "Tu es A-11, assistant de Jeffrey dans Visual Studio. Aide-le à coder de manière précise." },
                        new { role = "user", content = prompt }
                    },
                    temperature = 0.4
                };

                var json = JsonSerializer.Serialize(body);
                var resp = await _http.PostAsync(
                    A11Endpoint,
                    new StringContent(json, Encoding.UTF8, "application/json"));

                resp.EnsureSuccessStatusCode();
                var respText = await resp.Content.ReadAsStringAsync();

                using var doc = JsonDocument.Parse(respText);
                var root = doc.RootElement;

                string reply = root
                    .GetProperty("choices")[0]
                    .GetProperty("message")
                    .GetProperty("content")
                    .GetString() ?? "";

                AppendMessage("A-11", reply);
            }
            catch (Exception ex)
            {
                AppendMessage("Erreur", ex.Message);
            }
        }

        private void AppendMessage(string author, string text)
        {
            var block = new TextBlock
            {
                Text = $"{author}: {text}",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 4, 0, 4)
            };
            MessagesPanel.Children.Add(block);
        }
    }
}