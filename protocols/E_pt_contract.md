# Protocol E — `.pt` output contract

**Lazy-loaded by:** Phase 2 (before writing `tensorize.py`).

Before generating code, confirm the schema with the user. Default proposal:

```python
{
    "continuous":    FloatTensor[N, C_cont],
    "ordered_cat":   LongTensor[N, C_ord],
    "unordered_cat": LongTensor[N, C_unord],
    "multi_label":   FloatTensor[N, C_multi],          # multi-hot
    "text":          List[str],
    "mask":          BoolTensor[N, C_cont + C_ord + C_unord + C_multi],
    "timeseries": {                                     # one entry per long-format sheet
        "<sheet>": {
            "values": FloatTensor[N, T, D],
            "time":   FloatTensor[N, T],                # days since baseline
            "mask":   BoolTensor[N, T],
        },
    },
    "id":   List[str],                                  # row → entity ID
    "meta": {
        "feature_names":    {...},
        "split":            {"train": LongTensor, "val": LongTensor, "test": LongTensor},
        "continuous_stats": {...},                      # mean / std for inference-time z-scoring
        "schema_version":   1,
        "source_file":      "...",
    },
}
```

## Questions to ask

- Merge long-format sheets as **summary features** (mean / slope / last) or keep as **`[N, T, D]` tensors**?
- Alignment strategy for time series (fixed grid? event-time? pad + mask?)
- Train/val/test split: random, by entity, or by time?

## Round-trip assertions

The generated `tensorize.py` must produce a dict that round-trips through `torch.save` / `torch.load` and passes:

```python
out = torch.load("processed.pt", weights_only=False)
assert set(out) >= {"continuous", "unordered_cat", "ordered_cat", "mask", "id", "meta"}
N = len(out["id"])
for k in ("continuous", "unordered_cat", "ordered_cat", "mask"):
    assert out[k].shape[0] == N
assert not torch.isnan(out["continuous"]).any()           # all NaNs resolved + masked
assert (out["unordered_cat"] >= 0).all()                  # no -1 sentinels
assert out["meta"]["schema_version"] >= 1
for ts_name, ts in out.get("timeseries", {}).items():
    assert ts["values"].shape[:2] == ts["mask"].shape
    assert ts["time"].shape == ts["mask"].shape
```

Z-score parameters go in `meta["continuous_stats"]` so inference code can normalize new rows identically. Splits go in `meta["split"]` as index tensors, not separate files.
