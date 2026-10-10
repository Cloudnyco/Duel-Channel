// The official drawn size of enemy models, by prefab: the client scales every enemy Spine in its battle prefab, 0.27 for
// most; the others below (the transform product over the Spine renderer). modelScale = product / 0.27.
//
// Adapted from Stronghold Protocol (github.com/sganggs/Stronghold-Protocol), tools/build-data.mjs MODEL_SCALES /
// MODEL_STRETCH_Y / MIRRORED_PREFABS (measured over the local client by its tools/local-extract/enemy_scales.py and
// enemy_model_offsets.py), © its contributors, GPL-3.0-or-later; combined into this AGPL-3.0-or-later project as GNU GPL
// v3 section 13 permits.
const MODEL_SCALE_STANDARD = 0.27;
const MODEL_SCALES = new Map([
  [0.16, ['1005_yokai_3']],
  [0.18, ['1042_frostd']],
  [0.19, ['1112_emppnt', '1112_emppnt_2']],
  [0.2, ['1005_yokai', '1040_bombd', '1041_lazerd', '1041_lazerd_2']],
  [0.216, ['1067_snslime']],
  [0.22, ['1005_yokai_2', '1017_defdrn']],
  [0.23, ['1158_divman', '1161_tidmag', '1161_tidmag_2']],
  [0.24, ['1009_lurker', '1019_jshoot', '1019_jshoot_2', '1043_zomsbr', '1071_dftman', '1072_dlancer', '1116_liprr', '1116_liprr_2',
    '1118_lidbox_2', '1160_hvyslr', '1160_hvyslr_2', '1162_magmot', '1165_duhond', '1165_duhond_2', '1168_dumage', '1168_dumage_2',
    '1183_mlasrt', '1195_sfyin', '1195_sfyin_2', '1197_sfshu', '1197_sfshu_2', '1199_sfjin', '1203_sfhu', '1203_sfhu_2', '1207_sfji',
    '1207_sfji_2', '1209_sfden', '1209_sfden_2', '1267_nhpbr', '1267_nhpbr_2', '1269_nhfly', '1270_nhstlk', '1270_nhstlk_2',
    '1272_nhtank', '1272_nhtank_2', '1273_stmgun_2', '1275_dwlock_2', '1500_skulsr', '2002_bearmi', '2003_rockman', '2004_balloon',
    '2005_axetro', '2008_flking', '2034_sythef']],
  [0.25, ['1166_dusbr', '1166_dusbr_2', '1169_duphlx', '1169_duphlx_2', '1229_darmy', '1229_darmy_2']],
  [0.26, ['1000_gopro_2', '1023_jmage', '1025_reveng', '1026_aghost', '1046_agent', '1249_lysdb_2', '1251_lysyta', '1251_lysyta_2',
    '1252_lysytb_2', '1254_lypa_2', '1283_sgkill', '1283_sgkill_2', '1516_jakill', '1517_xi', '2001_duckmi']],
  [0.28, ['1006_shield', '1010_demon', '1010_demon_2', '1061_zomshd', '1062_rager_2', '1069_icebrk_2', '1119_vofsd', '1170_dushld',
    '1170_dushld_2', '1172_dugago', '1172_dugago_2', '1174_duholy', '1174_duholy_2', '1175_dushdo_2', '2025_syufo']],
  [0.29, ['1081_sotisd', '1513_dekght', '1513_dekght_2']],
  [0.297, ['2009_csaudc']],
  [0.3, ['1001_bigbo', '1045_hammer', '1045_hammer_2', '1121_lifbos', '1121_lifbos_2', '1501_demonk', '1535_wlfmster']],
  [0.31, ['1006_shield_2']],
  [0.34, ['1006_shield_3']],
  [0.35, ['1092_mdgint']],
  [0.4, ['1196_msfyin', '1196_msfyin_2', '1198_msfshu', '1198_msfshu_2', '1202_msfzhi', '1202_msfzhi_2']],
  [0.5, ['1208_msfji', '1208_msfji_2', '1210_msfden', '1210_msfden_2']],
  [0.6, ['1200_msfjin', '1200_msfjin_2', '1204_msfhu', '1204_msfhu_2']],
]);
export const MODEL_SCALE_BY_PREFAB = new Map();
for (const [v, list] of MODEL_SCALES) for (const k of list) MODEL_SCALE_BY_PREFAB.set(`enemy_${k}`, Math.round((v / MODEL_SCALE_STANDARD) * 1e4) / 1e4);

const MODEL_STRETCH_Y = new Map([
  [1.263, ['1112_emppnt', '1112_emppnt_2']],
]);
export const MODEL_STRETCH_Y_BY_PREFAB = new Map();
for (const [v, list] of MODEL_STRETCH_Y) for (const k of list) MODEL_STRETCH_Y_BY_PREFAB.set(`enemy_${k}`, v);

export const MIRRORED_PREFABS = new Set(['enemy_1196_msfyin']);
