"""Minimal stand-in for the HuggingFace ``datasets`` package.

Why this exists: on this LinuxONE / s390x VM, HuggingFace ``datasets`` cannot be
installed because it hard-requires ``pyarrow``, which has no s390x wheel and an
extremely heavy source build (Apache Arrow C++). ``tsfm_public`` imports only the
``Dataset`` class from ``datasets`` and uses it purely for type hints and
``isinstance()`` checks; the ``get_datasets`` code path we use builds torch
``ForecastDFDataset`` objects from a pandas DataFrame and never needs real HF
datasets.

This stub is kept in the project directory (NOT the shared venv) and is only put
on ``sys.path`` via ``PYTHONPATH`` when running the Uri Watch notebook headless,
so it does not shadow anything for other users of the shared environment.
"""


class Dataset:  # placeholder; isinstance(pandas_df, Dataset) is False, as intended
    pass


class DatasetDict(dict):
    pass


class IterableDataset:
    pass


def load_dataset(*args, **kwargs):
    raise RuntimeError(
        "HuggingFace `datasets` is not available on this s390x VM (no pyarrow wheel). "
        "This is a stub provided only so tsfm_public can be imported."
    )
