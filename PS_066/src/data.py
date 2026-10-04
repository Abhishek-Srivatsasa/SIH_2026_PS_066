"""Data acquisition, spatial subsetting, and coarsening pipeline for OceanEmbed.

Downloads physical reanalysis variables (SST, SSS, currents, SSH, subsurface temperature)
from Copernicus Marine GLORYS12V1, subselects standard depth targets down to ~1000 m,
and coarsens spatial grid from 1/12° to 0.25° resolution.
"""

import os
from typing import Dict, List, Optional
import numpy as np
import xarray as xr

# Standard target depths (m) matching the problem statement specification
TARGET_DEPTHS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000]

DATASET_ID = "cmems_mod_glo_phy_my_0.083deg_P1D-m"


def download_glorys_subset(
    output_dir: str = "data",
    min_lon: float = 80.0,
    max_lon: float = 90.0,
    min_lat: float = 10.0,
    max_lat: float = 20.0,
    start_datetime: str = "2021-01-01",
    end_datetime: str = "2021-06-30",
) -> None:
    """Download surface fields and profile targets from Copernicus Marine GLORYS.

    Requires prior authentication via copernicusmarine.login().
    """
    import copernicusmarine

    os.makedirs(output_dir, exist_ok=True)
    area = dict(
        minimum_longitude=min_lon,
        maximum_longitude=max_lon,
        minimum_latitude=min_lat,
        maximum_latitude=max_lat,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        output_directory=output_dir,
    )

    # Surface inputs: temperature, salinity, currents at the top level
    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=["thetao", "so", "uo", "vo"],
        minimum_depth=0,
        maximum_depth=1,
        output_filename="surface.nc",
        **area,
    )

    # Sea surface height has no depth axis, so it is requested separately
    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=["zos"],
        output_filename="zos.nc",
        **area,
    )

    # Target: temperature from the surface down to 1000 m
    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=["thetao"],
        minimum_depth=0,
        maximum_depth=1000,
        output_filename="profile.nc",
        **area,
    )


def coarsen(ds: xr.Dataset) -> xr.Dataset:
    """Average each 3x3 block of grid cells to reduce 1/12° resolution to 0.25°."""
    return ds.coarsen(latitude=3, longitude=3, boundary="trim").mean()


def prepare_dataset(
    data_dir: str = "data",
    output_path: str = "data/prepared.npz",
    split_date: str = "2021-05-01",
) -> Dict[str, np.ndarray]:
    """Load NetCDF files, coarsen grids, extract 15 depths, and compute train normalisation.

    Saves prepared arrays to output_path.
    """
    sur = xr.open_dataset(os.path.join(data_dir, "surface.nc")).isel(depth=0, drop=True)
    zos = xr.open_dataset(os.path.join(data_dir, "zos.nc"))
    pro = xr.open_dataset(os.path.join(data_dir, "profile.nc"))

    # Pick the model levels closest to the 15 standard depths
    pro = pro.sel(depth=TARGET_DEPTHS, method="nearest")

    sur, zos, pro = coarsen(sur), coarsen(zos), coarsen(pro)
    assert (sur.time.values == pro.time.values).all() and (zos.time.values == pro.time.values).all()

    # Inputs: SST, SSS, SSH, current U, current V -> (time, 5, lat, lon)
    X = np.stack(
        [
            sur.thetao.values,
            sur.so.values,
            zos.zos.values,
            sur.uo.values,
            sur.vo.values,
        ],
        axis=1,
    )

    # Target: temperature at 15 depths -> (time, 15, lat, lon)
    Y = pro.thetao.values

    # Train on Jan-Apr, test on May-Jun (the test period is never seen in training)
    ntrain = int((pro.time.values < np.datetime64(split_date)).sum())

    # Normalise using training-period statistics only
    mu_x = np.nanmean(X[:ntrain], axis=(0, 2, 3), keepdims=True)
    sd_x = np.nanstd(X[:ntrain], axis=(0, 2, 3), keepdims=True)
    mu_y = np.nanmean(Y[:ntrain], axis=(0, 2, 3), keepdims=True)
    sd_y = np.nanstd(Y[:ntrain], axis=(0, 2, 3), keepdims=True)

    Xn = np.nan_to_num((X - mu_x) / sd_x).astype("float32")
    Yn = np.nan_to_num((Y - mu_y) / sd_y).astype("float32")
    M = (~np.isnan(Y)).astype("float32")  # 1 = valid ocean point, 0 = land or below seafloor

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    np.savez(
        output_path,
        Xn=Xn,
        Yn=Yn,
        M=M,
        ntrain=ntrain,
        mu_y=mu_y,
        sd_y=sd_y,
        lat=pro.latitude.values,
        lon=pro.longitude.values,
    )

    return {
        "Xn": Xn,
        "Yn": Yn,
        "M": M,
        "ntrain": ntrain,
        "mu_y": mu_y,
        "sd_y": sd_y,
        "lat": pro.latitude.values,
        "lon": pro.longitude.values,
    }
