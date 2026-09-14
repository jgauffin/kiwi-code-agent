use std::fmt;

/* block /* nested */ still comment { */
#[derive(Debug)]
pub struct Point<'a> {
    name: &'a str,
}

impl<'a> fmt::Display for Point<'a> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let raw = r#"has " and { brace"#;
        let c = '{';
        write!(f, "{}", self.name)
    }
}

pub fn run<T>(items: Vec<T>) -> Result<(), String>
where
    T: Clone,
{
    let closure = |x: u32| {
        x + 1
    };
    match items.len() {
        0 => Err(String::new()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(1, 1);
    }
}
