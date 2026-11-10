"""Root-owned test supervisor. EOF cancels only this helper's process group."""
import ctypes
import os
import selectors
import signal
import subprocess
import sys

# Adopt and reap descendants after the intentional crash probes. The root host
# survives cancellation long enough to clean its group even when sudo was used.
if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'Cannot own test descendants')
child = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, start_new_session=True)
with selectors.DefaultSelector() as selector:
    pidfd = os.pidfd_open(child.pid)
    try:
        selector.register(pidfd, selectors.EVENT_READ, 'exit')
        selector.register(sys.stdin, selectors.EVENT_READ, 'cancel')
        cancelled = any(key.data == 'cancel' for key, _ in selector.select())
    finally:
        os.close(pidfd)
# Keep the exited leader unreaped until its group is cleaned. Its zombie pins
# the group identity, preventing a recycled PID from naming an unrelated group.
try:
    os.killpg(child.pid, signal.SIGKILL)
except ProcessLookupError:
    pass
code = child.wait()
while True:
    try:
        os.waitpid(-1, 0)
    except ChildProcessError:
        break
sys.exit(125 if cancelled else code if code >= 0 else 128 - code)
