<?php
namespace App;

# hash comment { brace
class Greeter extends Base {
    public function greet(string $name): string {
        $f = function ($x) use ($name) {
            return "{$name} $x";
        };
        if ($name === '{') {
            return $f('a');
        }
        return 'hi';
    }
}

function helper(array $items = []): int {
    foreach ($items as $item) {
        echo $item;
    }
    return count($items);
}

$g = function () {
    return 1;
};
