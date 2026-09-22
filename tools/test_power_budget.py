import pytest

import power_budget as pb


def test_divider_currents():
    assert pb.DIV_AS_BUILT_UA == pytest.approx(18.0)
    assert pb.DIV_1M_UA == pytest.approx(1.8)


def test_single_ldo_never_lowers_the_floor():
    # A linear regulator passes the load current through and adds its own.
    assert pb.floor_ua("B") > pb.floor_ua("A")


def test_switched_domains_lower_the_floor():
    assert pb.floor_ua("C") < pb.floor_ua("A") / 5
    assert pb.floor_ua("C+GNSS") == pytest.approx(pb.floor_ua("C") - 20.0 + 8.01)


def test_mcu_awake_covers_longest_burst_plus_tx():
    mcu = pb.cycle(True)[-1]
    assert mcu.s == pytest.approx(pb.BMV080_S + pb.TX_S)
    mcu = pb.cycle(False)[-1]
    assert mcu.s == pytest.approx(pb.GNSS_HOT_S + pb.TX_S)


def test_average_is_floor_plus_active():
    period = 600
    active_ua = pb.cycle_mc(pb.cycle(True)) / period * 1e3
    assert pb.average_ua("A", period, 1) == pytest.approx(pb.floor_ua("A") + active_ua)
    active_ua = pb.cycle_mc(pb.cycle(False)) / period * 1e3
    assert pb.average_ua("A", period, 0) == pytest.approx(pb.floor_ua("A") + active_ua)
