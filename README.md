## Updates in [Lila](https://github.com/lichess-org/lila)

### package.json

```json
  "devDependencies": {
    "chessground3D": "github:yafred/chessground3D",
```

### ui/lib/package.json

```json
  "build": {
    "sync": {
      "/node_modules/chessground3D/assets/scene.glb": "/public"
    },
```

### pnpm-workspace.yaml

```yaml
allowBuilds:
  chessground3D@https://codeload.github.com/yafred/chessground3D/tar.gz/<commit_id>: true
```

```bash
pnpm update chessground3D
```

```yaml
chessground3D:
  specifier: github:yafred/chessground3D
  version: https://codeload.github.com/yafred/chessground3D/tar.gz/<commit_id>
```

### Search and replace in \*.ts files

```
from '@lichess-org/chessground';
```

becomes

```
from 'chessground3D';
```

### Crazyhouse

```
from '@lichess-org/chessground/drag';
```

becomes

```
from 'chessground3D/drag';
```
