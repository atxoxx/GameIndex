//! Minimal, dependency-free bencode reader for `.torrent` files.
//!
//! Plugins occasionally need to inspect a `.torrent` payload (file list,
//! exact size) without handing it to the torrent engine. Pulling a full
//! bencode crate in for that would grow the binary for one narrow use,
//! so this module implements only the subset needed to describe a
//! torrent and computes the info-hash the same way BitTorrent does
//! (SHA-1 over the raw bencoded `info` dictionary, not a re-encode).

use sha1::{Digest, Sha1};

/// A parsed bencode value. Dictionaries keep their entry order because
/// the info-hash must be taken over the original byte span, which is
/// recorded separately by [`parse_torrent`].
enum BValue {
    Int(i64),
    Bytes(Vec<u8>),
    List(Vec<BValue>),
    Dict(Vec<(Vec<u8>, BValue)>),
}

impl BValue {
    fn as_dict(&self) -> Option<&[(Vec<u8>, BValue)]> {
        match self {
            BValue::Dict(d) => Some(d),
            _ => None,
        }
    }

    fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            BValue::Bytes(b) => Some(b),
            _ => None,
        }
    }

    fn as_int(&self) -> Option<i64> {
        match self {
            BValue::Int(i) => Some(*i),
            _ => None,
        }
    }

    fn as_list(&self) -> Option<&[BValue]> {
        match self {
            BValue::List(l) => Some(l),
            _ => None,
        }
    }

    fn get<'a>(dict: &'a [(Vec<u8>, BValue)], key: &str) -> Option<&'a BValue> {
        dict.iter()
            .find(|(k, _)| k.as_slice() == key.as_bytes())
            .map(|(_, v)| v)
    }
}

struct Parser<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn peek(&self) -> Option<u8> {
        self.data.get(self.pos).copied()
    }

    fn expect(&mut self, byte: u8, what: &str) -> Result<(), String> {
        if self.peek() == Some(byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(format!("torrent: expected {what} at byte {}", self.pos))
        }
    }

    fn parse_value(&mut self) -> Result<BValue, String> {
        match self.peek() {
            Some(b'i') => self.parse_int(),
            Some(b'l') => self.parse_list(),
            Some(b'd') => self.parse_dict(),
            Some(c) if c.is_ascii_digit() => self.parse_bytes().map(BValue::Bytes),
            Some(c) => Err(format!("torrent: unexpected byte {c:#04x} at {}", self.pos)),
            None => Err("torrent: unexpected end of input".to_string()),
        }
    }

    fn parse_int(&mut self) -> Result<BValue, String> {
        self.expect(b'i', "integer start")?;
        let start = self.pos;
        while self.peek().is_some_and(|c| c != b'e') {
            self.pos += 1;
        }
        let text = std::str::from_utf8(&self.data[start..self.pos])
            .map_err(|_| "torrent: integer is not valid UTF-8".to_string())?;
        self.expect(b'e', "integer terminator")?;
        let value = text
            .parse::<i64>()
            .map_err(|_| format!("torrent: invalid integer {text:?}"))?;
        Ok(BValue::Int(value))
    }

    fn parse_bytes(&mut self) -> Result<Vec<u8>, String> {
        let start = self.pos;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.pos += 1;
        }
        if self.pos == start {
            return Err("torrent: expected byte-string length".to_string());
        }
        let len = std::str::from_utf8(&self.data[start..self.pos])
            .map_err(|_| "torrent: byte-string length is not ASCII".to_string())?
            .parse::<usize>()
            .map_err(|_| "torrent: byte-string length overflow".to_string())?;
        self.expect(b':', "byte-string colon")?;
        let end = self
            .pos
            .checked_add(len)
            .ok_or_else(|| "torrent: byte-string length overflow".to_string())?;
        if end > self.data.len() {
            return Err("torrent: byte-string overruns input".to_string());
        }
        let out = self.data[self.pos..end].to_vec();
        self.pos = end;
        Ok(out)
    }

    fn parse_list(&mut self) -> Result<BValue, String> {
        self.expect(b'l', "list start")?;
        let mut items = Vec::new();
        while self.peek() != Some(b'e') {
            if self.peek().is_none() {
                return Err("torrent: unterminated list".to_string());
            }
            items.push(self.parse_value()?);
        }
        self.expect(b'e', "list terminator")?;
        Ok(BValue::List(items))
    }

    fn parse_dict(&mut self) -> Result<BValue, String> {
        self.expect(b'd', "dictionary start")?;
        let mut entries = Vec::new();
        while self.peek() != Some(b'e') {
            if self.peek().is_none() {
                return Err("torrent: unterminated dictionary".to_string());
            }
            let key = self.parse_bytes()?;
            let value = self.parse_value()?;
            entries.push((key, value));
        }
        self.expect(b'e', "dictionary terminator")?;
        Ok(BValue::Dict(entries))
    }
}

/// Parse a `.torrent` payload into the JSON shape handed to plugins:
///
/// ```text
/// { name: String,
///   totalSize: u64,                       // sum of every file's size
///   infohash: String,                     // lowercase hex SHA-1 of the raw info dict
///   files: [ { path: String, size: u64 } ] }
/// ```
///
/// Single-file torrents (`info.length`) produce one entry named after
/// `info.name`; multi-file torrents (`info.files[].length`) join the
/// `path` list with `/`. Anything malformed returns an ordinary error.
pub fn parse_torrent(bytes: &[u8]) -> Result<serde_json::Value, String> {
    let mut parser = Parser::new(bytes);
    parser.expect(b'd', "top-level dictionary")?;

    let mut info: Option<BValue> = None;
    // Byte span of the raw `info` value, used verbatim for the info-hash.
    let mut info_span: Option<(usize, usize)> = None;

    while parser.peek() != Some(b'e') {
        if parser.peek().is_none() {
            return Err("torrent: unterminated top-level dictionary".to_string());
        }
        let key = parser.parse_bytes()?;
        if key == b"info" {
            let start = parser.pos;
            let value = parser.parse_value()?;
            info_span = Some((start, parser.pos));
            info = Some(value);
        } else {
            let _ = parser.parse_value()?;
        }
    }

    let info = info.ok_or_else(|| "torrent: missing info dictionary".to_string())?;
    let (start, end) =
        info_span.ok_or_else(|| "torrent: missing info dictionary".to_string())?;
    let dict = info
        .as_dict()
        .ok_or_else(|| "torrent: info is not a dictionary".to_string())?;

    let name = BValue::get(dict, "name")
        .and_then(|v| v.as_bytes())
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .unwrap_or_default();

    let mut files: Vec<serde_json::Value> = Vec::new();
    let mut total: u64 = 0;

    if let Some(length) = BValue::get(dict, "length").and_then(|v| v.as_int()) {
        let size = length.max(0) as u64;
        total += size;
        files.push(serde_json::json!({ "path": name, "size": size }));
    } else if let Some(list) = BValue::get(dict, "files").and_then(|v| v.as_list()) {
        for file in list {
            let Some(fd) = file.as_dict() else { continue };
            let size = BValue::get(fd, "length")
                .and_then(|v| v.as_int())
                .unwrap_or(0)
                .max(0) as u64;
            let path = BValue::get(fd, "path")
                .and_then(|v| v.as_list())
                .map(|parts| {
                    parts
                        .iter()
                        .filter_map(|p| p.as_bytes())
                        .map(|b| String::from_utf8_lossy(b).into_owned())
                        .collect::<Vec<_>>()
                        .join("/")
                })
                .unwrap_or_default();
            total += size;
            files.push(serde_json::json!({ "path": path, "size": size }));
        }
    }

    let mut hasher = Sha1::new();
    hasher.update(&bytes[start..end]);
    let infohash = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();

    Ok(serde_json::json!({
        "name": name,
        "totalSize": total,
        "infohash": infohash,
        "files": files,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_file_torrent() {
        // d 4:info d 6:length i1234e 4:name 8:test.iso e e
        let data = b"d4:infod6:lengthi1234e4:name8:test.isoee";
        let v = parse_torrent(data).expect("parse single-file torrent");

        assert_eq!(v["name"], "test.iso");
        assert_eq!(v["totalSize"], 1234);
        // SHA-1 of the raw info dict `d6:lengthi1234e4:name8:test.isoe`.
        assert_eq!(
            v["infohash"],
            "ab6a966b3f50a06a5090fb78f71a753190641f38"
        );
        let files = v["files"].as_array().expect("files array");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0]["path"], "test.iso");
        assert_eq!(files[0]["size"], 1234);
    }

    #[test]
    fn parses_multi_file_torrent() {
        // info = d 5:files l <file> <file> e 4:name 3:root e
        let data = b"d4:infod5:filesld6:lengthi100e4:pathl1:a1:beed6:lengthi200e4:pathl1:ceee4:name4:rootee";
        let v = parse_torrent(data).expect("parse multi-file torrent");

        assert_eq!(v["name"], "root");
        assert_eq!(v["totalSize"], 300);
        let files = v["files"].as_array().expect("files array");
        assert_eq!(files.len(), 2);
        assert_eq!(files[0]["path"], "a/b");
        assert_eq!(files[0]["size"], 100);
        assert_eq!(files[1]["path"], "c");
        assert_eq!(files[1]["size"], 200);
    }

    #[test]
    fn malformed_torrent_is_an_error() {
        // Length prefix promises more bytes than the input holds.
        let err = parse_torrent(b"d4:info9:xxxxxxxxxe").unwrap_err();
        assert!(err.contains("torrent:"), "unexpected: {err}");

        // Not a dictionary at all.
        assert!(parse_torrent(b"i42e").is_err());
        assert!(parse_torrent(b"").is_err());
    }
}
