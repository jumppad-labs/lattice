# TODO

## Proto Dependencies

Currently, `Resource` and `Field` proto messages are duplicated in both:
- `loki/api/meta/v1/meta.proto` (source of truth)
- `lattice/api/observer/v1/observer.proto` (copy)

**Future improvement:** Configure Lattice to import from Polymorph's protos directly.

### Option 1: Buf Schema Registry (BSR)
1. Push Polymorph protos to BSR: `buf push`
2. Add to `lattice/buf.yaml`:
   ```yaml
   deps:
     - buf.build/jumppad-labs/polymorph
   ```
3. Import in `observer.proto`:
   ```protobuf
   import "meta/v1/meta.proto";
   ```

### Option 2: Local Development
Use buf workspace for local development:
```yaml
# norncorp/buf.work.yaml
version: v2
directories:
  - loki
  - lattice
```

For now, keep protos in sync manually. Changes to Resource/Field must be applied to both files.
