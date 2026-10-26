"""
Fetches the studio recordings scripts/prepare-sounds.py builds the game's sounds from, into a
folder of your choosing (outside the repository: the licence allows the sounds inside the game,
not redistributed as a library):

    python scripts/fetch-sounds.py SOURCE_DIR
    python scripts/prepare-sounds.py SOURCE_DIR
    python scripts/prepare-vehicle-sounds.py SOURCE_DIR

They come from the Sonniss GameAudioGDC bundles (2015, 2020, 2023 and 2024), which are only published as
multi-gigabyte zips. Rather than download those whole, this reads each zip's table of contents
and then just the files listed below, over HTTP range requests: about 800 MB instead of ~120 GB.
Licence: https://sonniss.com/gdc-bundle-license/ (see CREDITS.md).
"""
import io
import os
import sys
import urllib.request
import zipfile

AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# (local name, bundle zip, file name inside it)
FILES = [
    ('eng_q2_revs', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'VEHCar_Audi Q2 ONBOARD Driving Sequence With Revs Up And Down EXHAUST RIGHT_DRCA_AUQ2_MKH8040.wav'),
    ('eng_q2_idle', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'VEHCar_Audi Q2 ONBOARD Turn On Start Long Idle Stop Shutoff EXHAUST CENTER_DRCA_AUQ2_UsiPro.wav'),
    ('eng_porsche_idle', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle5of9.zip', 'Porsche, Carrera, GT, t7, Onbrd, Start, Idle, Steady, Blips, Off, Engine, Mix.wav'),
    ('eng_porsche_fast', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle5of9.zip', 'Porsche, Carrera, GT, t9, Onbrd, Fast, Drive, Various, Engine, VP88.wav'),
    ('eng_tractor_rev', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'VEHFarm_Tractor Magnum 7250 ONBOARD Driving Sequence Idle And Revving ENGINE LEFT_DRCA_MAGN_UsiPro.wav'),
    ('eng_tractor_steady', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'VEHFarm_Tractor Magnum 7250 ONBOARD Driving Sequence Constant RPMs 01 INTERIOR_DRCA_MAGN_MK012.wav'),
    ('eng_rv_idle', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle4of9.zip', 'Fiat RV - t11 - ONBRD - IDLE - Various - ENGINE - Right - PZM.wav'),
    ('horn_q7', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'VEHHorn_Audi Q7 EXTERIOR Horn Short And Long MONO_DRCA_AUQ7_Kmr81i.wav'),
    ('horn_coach', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle6of9.zip', 'Man Lions Coach - VAR SFX - Horn Various - Mono - RSM191.wav'),
    ('horn_r4', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle2of9.zip', 'VEHHorn_Renault R4 GTL Horn Signal 01 Interior_JSE_RR4_Mono.wav'),
    ('door_corvette', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'VEHDoor_1967 Corvette EXT-Drivers Door Open & Close 03_GoldSND_M1C 101419_aayuRl#mUfTk.wav'),
    ('crash_impacts', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Car Impacts and Scrapes 19 A.wav'),
    ('crash_smash', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Metal Impact Smash Move 07 B.M.wav'),
    ('crash_drop', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Metal Impact Drop 01 A.wav'),
    ('glass_shatter', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Shattered Glass Impact 10 A.wav'),
    ('glass_windshield', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Car Windshield Ripping 04 A.wav'),
    ('glass_break', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle2of9.zip', 'GLASBrk_Glass Break Hit_04_MWSFX_GL.wav'),
    ('explode_car', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'DESTRCrsh_Designed Car Explosion With Metal Breaking And Glass Shattering  06_DDUMAIS_NONE.wav'),
    ('glass_jol_1', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'JOL_0707_GlassImpact_02_COMP.wav'),
    ('glass_jol_2', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'JOL_0753_GlassImpact_07_Senn8020.wav'),
    ('explode_medium', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'EXPLReal_Medium Realistic Explosion 15_DDUMAIS_NONE.wav'),
    ('explode_mortar', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Mortar Explosion 08.wav'),
    ('explode_distant', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle6of9.zip', 'Tank Mine - EXPLOSION - Mounted on Metal Beam - DISTANT - AMBEO BLD.wav'),
    ('pistol_close', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle4of9.zip', 'Colt Python 357 Magnum - FIRING - Take 1 - 4m Left - CSS5.wav'),
    ('pistol_far', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle4of9.zip', 'Colt Python 357 Magnum - FIRING - Take 3 - 160m Behind - ORTF - CM4.wav'),
    ('pistol_50cal', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT .50 Cal Pistol Shots 02 A.wav'),
    ('rifle_m4', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT M4 Shots 02 B.wav'),
    ('shotgun_saiga', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle1of9.zip', 'GUNShotg_Saiga 12 Cal.12 DESIGNED Single Shot Core Long_DRCA_SG12_Stereo.wav'),
    ('shotgun_spas', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle5of9.zip', 'SPAS-12 - FIRING - Pump Action - Take 1 - 20m In Front - AB - MKH8020.wav'),
    ('shotgun_pump', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle5of9.zip', 'SPAS-12 - VAR SFX - Pump Action Fast - Close - MS - MKH418s.wav'),
    ('rocket_rpg', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle6of9.zip', 'RPG - FIRING AND IMPACT - Through Car Roof Hit Metal - XY - MKH8040.wav'),
    ('reload_charge', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX INT AR-15 M4 Charging Handle With Mag 01_A.wav'),
    ('reload_mag', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle4of9.zip', 'Desert Eagle - VAR SFX - Magazine In and Out - Take 3 - MKH8060.wav'),
    ('equip_hammer', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle4of9.zip', 'Dan Wesson 445 - VAR SFX - Cock Uncock Hammer - MS Decoded - MKH418s.wav'),
    ('hit_hk_1', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Seq1.15 Hit #1 96 HK1.wav'),
    ('hit_hk_2', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Seq 2.1 Hit #2 96 HK1.wav'),
    ('hit_hk_3', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Seq 2.27 Hit #3 96 HK1.wav'),
    ('whoosh_hk_1', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Seq1.15 whoosh #1 96 HK1.wav'),
    ('whoosh_hk_2', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Seq 2.27 whoosh #1 96 HK1.wav'),
    ('swish_action', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Action Swish_HW 02.wav'),
    ('impact_iron', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle6of9.zip', 'Iron - Thick - HIT - Hammer.wav'),
    ('impact_barrel', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle6of9.zip', 'Oil Barrel - HIT - Hammer - Take 2.wav'),
    ('siren_doppler', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Police Siren 01 Doppler By Slow 01.wav'),
    ('siren_02', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Emergency Siren 02 A.wav'),
    ('siren_10', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Emergency Siren 10 B.wav'),
    ('siren_distant', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'EFX EXT Emergency Siren Distant 18 B.wav'),
    ('amb_street', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle9of9.zip', 'AMBUrbn_City, Buffalo, Residential, Traffic, General_UberDuo_HOOD.wav'),
    ('amb_waves', 'https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip', 'Waves 03.wav'),
    ('heli_flyby', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle6of9.zip', 'Helicopter - Military - FLY - By - Overhead - ORTF - MKH8040.wav'),
    ('whizz_pmsfx', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_BBI_Bullet_Passby_Whizzby_Airy_5.wav'),
    ('whip_og', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'Whip sound 21.wav'),
    ('hit_dirt', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_BBI_Bullet_Impact_Dirt_3.wav'),
    ('hit_glass', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_BBI_Bullet_Impact_Glass_1.wav'),
    ('hit_flesh', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_BBI_Bullet_Impact_Hit_Body_Flesh_25.wav'),
    ('hit_rock_og', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'Bullet rock Impact 4.wav'),
    ('hit_light_og', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'Bullet Impact 16 - Light Version.wav'),
    ('hit_brick_16', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_SB_SOURCE_16 Impact brick rock dirt gravel single hit.wav'),
    ('hit_brick_61', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_SB_SOURCE_61 Impact brick rock dirt gravel single hit.wav'),
    ('hit_stone_53', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_RI_Source_53 Rocks Impact Hit Single Stone.wav'),
    ('hit_stone_92', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'PM_RI_Source_92 Rocks Impact Hit Single Stone.wav'),
    ('hit_tile', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'DESTRCrsh_Smashing a ceramics tile on concrete  exterior_Eneas Mentzel_Debris & Rubble_04.wav'),
    ('casings_concrete', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part9of14.zip', '9 mm x 21  - Casings Shell & Cartdridges - Roll on Concrete Floor - Outdoor.wav'),
    ('ak_close', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part3of14.zip', 'AKSD0813 AK-74 spot A close burst 03 rounds.wav'),
    ('ak_far', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part3of14.zip', 'AKSD0854 AK-74 spot D far burst 03 rounds.wav'),
    ('ak_distant', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part3of14.zip', 'AK0405 AK-74 rear long distance burst 05 rounds.wav'),
    ('pistol_og', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part5of14.zip', 'Hand Gun 6.wav'),
    ('mosin_distant', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part4of14.zip', 'MNSD0315 MOSIN-NAGANT mixed long distance shot.wav'),
    ('skid_bmw', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part3of14.zip', 'BMW1104 BMW 520i Spot A Start Fast Drive with Aggressive Starts and Stops with Skids Stop.wav'),
    ('eng_unimog', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'VEHTruck_Unimog ONBOARD Turn On Start Ramp Rev Up And Down X2 Stop Shutoff MIX_DRCA_UNIM_Mix.wav'),
    ('glass_bz_1', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'Bluezone_BC0274_glass_impact_break_002.wav'),
    ('glass_bz_2', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'Bluezone_BC0274_glass_impact_break_falling_debris_004.wav'),
    ('glass_bz_3', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'Bluezone_BC0274_glass_impact_break_small_014.wav'),
    ('explode_urban', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'Bluezone_BC0277_explosion_urban_004_02.wav'),
    ('explode_mortar_bz', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'Bluezone_BC0277_explosion_mortar_002_01.wav'),
    ('cartridge_bz', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle2of14.zip', 'Bluezone_BC0277_cartridge_case_handling_018.wav')
    # Vehicles (scripts/prepare-vehicle-sounds.py)
    ('eng_master_ramps', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part12of14.zip', 'renault master 2.3 dci engine diesel rpm ramps.wav'),
    ('eng_ape_drive', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part8of14.zip', 'Ape_P703V_t3_Onbrd_Start_Fast_Drive_Stop_Reverse_Stop_Drive_Stop_Off_Engine_Intake_DPA4062.wav'),
    ('eng_crownvic_steady', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle5of14.zip', 'Ford Crown Victoria - t6 - ONBRD - STEADY RPMS - Drive - ENGINE - Left - DPA4061.wav'),
    ('eng_crownvic_idle', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle5of14.zip', 'Ford Crown Victoria - t11 - EXT - IDLE - Stall Various - ENGINE - Left - DPA4061.wav'),
    ('tyre_ibiza', 'https://downloads.sonniss.com/Sonniss.com-GDC2023-GameAudioBundle13of14.zip', 'VEHTire_Car Driving-VEHTire_Car Driving-Car Driving Tires AB BK_EXT_SYSO_SYSO012.wav'),
    ('air_ural', 'https://downloads.sonniss.com/Sonniss.com%20-%20GDC%202020%20-%20Game%20Audio%20Bundle%20Part4of14.zip', 'URL1711A Truck Ural Spot A Details Air Exterior.wav'),
    ('gear_quattro', 'https://downloads.sonniss.com/Sonniss.com-GDC2024-GameAudioBundle3of9.zip', 'Audi Quattro - t12 - VAR SFX - Gear Stick Dry Movement - ENGINE - Center - MKH8020.wav'),
]


class RangeFile(io.RawIOBase):
    """A remote file read by HTTP range requests, small reads cached in 256 KB blocks."""

    BLOCK = 262144

    def __init__(self, url):
        self.url = url
        with urllib.request.urlopen(self._request(method="HEAD"), timeout=60) as response:
            self.size = int(response.headers["Content-Length"])
        self.pos = 0
        self.blocks = {}

    def _request(self, method="GET", byte_range=None):
        headers = {"User-Agent": AGENT, "Referer": "https://gdc.sonniss.com/"}
        if byte_range:
            headers["Range"] = "bytes=%d-%d" % byte_range
        return urllib.request.Request(self.url, method=method, headers=headers)

    def _fetch(self, start, end):
        with urllib.request.urlopen(self._request(byte_range=(start, end)), timeout=120) as response:
            return response.read()

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        if n < self.BLOCK:
            block = self.pos // self.BLOCK
            if block not in self.blocks:
                self.blocks[block] = self._fetch(block * self.BLOCK, min(self.size, (block + 1) * self.BLOCK) - 1)
            data = self.blocks[block]
            offset = self.pos - block * self.BLOCK
            out = data[offset:offset + n]
            self.pos += len(out)
            if len(out) < n and self.pos < self.size:
                return out + self.read(n - len(out))
            return out
        out = self._fetch(self.pos, min(self.size, self.pos + n) - 1)
        self.pos += len(out)
        return out

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    archives = {}
    for name, url, inside in FILES:
        target = os.path.join(out, name + ".wav")
        if os.path.exists(target) and os.path.getsize(target) > 0:
            continue
        for attempt in range(4):
            try:
                if url not in archives:
                    archives[url] = zipfile.ZipFile(io.BufferedReader(RangeFile(url), buffer_size=262144))
                archive = archives[url]
                # Matched on the file's own name: folder names in these zips aren't all ASCII.
                entry = next(info for info in archive.infolist() if info.filename.split("/")[-1] == inside)
                with archive.open(entry) as source, open(target + ".part", "wb") as sink:
                    while chunk := source.read(1 << 20):
                        sink.write(chunk)
                os.replace(target + ".part", target)
                print("got", name, flush=True)
                break
            except Exception as error:  # noqa: BLE001 - the mirrors refuse now and then; try again
                archives.pop(url, None)
                print("retry", name, error, flush=True)
        else:
            print("FAILED", name, flush=True)


main()
