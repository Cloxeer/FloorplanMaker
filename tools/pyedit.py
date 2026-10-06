# helper: edit(path, [(old, new), ...]) keeping the file's own line endings
def edit(p, pairs):
    s = open(p, encoding='utf-8', newline='').read()
    crlf = '\r\n' in s
    for a, b in pairs:
        if crlf:
            a = a.replace('\r\n', '\n').replace('\n', '\r\n'); b = b.replace('\r\n', '\n').replace('\n', '\r\n')
        assert a in s, 'NOT FOUND: ' + a[:70]
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf-8', newline='').write(s)
