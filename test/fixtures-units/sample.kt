package demo

data class User(val name: String) : Base() {
    val label = "user ${name.length} {x}"
}

object Registry {
    fun register(user: User): Boolean {
        return users.any { it.name == user.name }
    }

    fun String.shout() {
        println("""raw { $this }""")
    }
}

fun main() {
    val users = listOf(User("a"))
    users.forEach {
        when (it.name) {
            "a" -> println('{')
        }
    }
}
