import os


class Greeter:
    """Doc with def inside: def fake(): pass"""

    def __init__(self, name):
        self.name = name

    def greet(self, extra=None):
        def inner():
            return "{"
        if extra:
            return inner()
        return f"hi {self.name}"


def helper(a,
           b):
    return a + b


async def fetch(
    url,
):
    data = {
        'k': 1,
    }
    return data


VALUE = helper(
    1, 2)
