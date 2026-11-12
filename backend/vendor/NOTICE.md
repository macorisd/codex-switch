# Bundled Linux credential connector

Jeepney 0.9.0 is a pure-Python D-Bus client with no runtime dependencies.
The unmodified official wheel contains its MIT license and copyright notice.

- Source: https://gitlab.com/takluyver/jeepney
- Documentation: https://jeepney.readthedocs.io/en/latest/
- Distribution: https://pypi.org/project/jeepney/0.9.0/
- File: `jeepney-0.9.0-py3-none-any.whl`
- SHA-256: `97e5714520c16fc0a45695e5365a2e11b81ea79bba796e26f9f1d178cb182683`

The native connector verifies this hash before importing the bundled wheel.
Neither the extension nor its standalone auth helper downloads dependencies or
installs Python packages at runtime. This client is only used on Linux; Windows
uses DPAPI and macOS uses Apple's Security/CoreFoundation frameworks directly.
