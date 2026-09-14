package demo;

@Service
public class Greeter implements Runnable {
    private static final String TEXT = """
        { text block }
        """;

    @Override
    public void run() {
        Runnable r = () -> {
            System.out.println("{");
        };
        new Thread(r) {
        }.start();
    }

    static {
        init();
    }
}

record Point(int x, int y) {}

enum Color { RED, GREEN }
