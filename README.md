## Use it online

https://yafred.github.io/chess3D/

## Integrate in [Lila](https://github.com/lichess-org/lila)

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

### edit pnpm-workspace.yaml

```yaml
allowBuilds:
  chessground3D@https://codeload.github.com/yafred/chessground3D/tar.gz/<commit_id>: true
```

### update pnpm-lock.yaml

```bash
pnpm update chessground3D
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
