using System;

namespace Demo
{
    [Attr("x")]
    public class Widget : Base, IThing
    {
        private readonly string _text = @"multi
line { with brace";
        private string Name { get; set; }

        public int Count
        {
            get { return 1; }
            set { _count = value; }
        }

        public Widget(int a) : base(a)
        {
            var s = $"value {a} and {{literal}} {new List<int> { 1, 2 }.Count}";
            var raw = """
                { not code }
                """;
        }

        public async Task<Result> RunAsync<T>(T input) where T : class
        {
            foreach (var x in items)
            {
                Action a = () => { Console.WriteLine('{'); };
            }
            var y = input switch
            {
                null => 0,
                _ => 1,
            };
        }
    }

    public record Point(int X, int Y)
    {
        public int Sum() => X + Y;
    }

    public enum Kind { A, B }

    public struct Pair
    {
        public int A;
    }
}
