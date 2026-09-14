#include <stdio.h>
#define BLOCK { \
    int x; }

struct point {
    int x;
};

typedef struct {
    int a;
} pair;

static int add(int a, int b) {
    const char *s = "{" "}";
    char c = '{';
    return a + b;
}

struct point *make(void) {
    for (int i = 0; i < 2; i++) {
    }
    return NULL;
}

int main(int argc, char **argv) {
    const char *raw = R"x(raw { )x";
    return add(1, 2);
}
