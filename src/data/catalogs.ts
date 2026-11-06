import { CatalogItem } from '../types';

export const EXCLUDE_UI_TV_IDS: string[] = [];

export const DEFAULT_TV_CATALOGS: CatalogItem[] = [
  { id: 'tv_tong_hop', name: '📺 Toàn Bộ Kênh TV', type: 'tv', apiPath: 'live', defaultChecked: true },
  { id: 'tv_quoc_te', name: '🌐 Kênh Quốc Tế', type: 'tv', apiPath: 'live', defaultChecked: true },
  { id: 'tv_vtv', name: '🔴 Kênh VTV', type: 'tv', apiPath: 'live', defaultChecked: true },
  { id: 'sports_live_matches', name: '⚽ Bóng Đá Live', type: 'tv', apiPath: 'live', defaultChecked: true },
];

export const DEFAULT_MOVIE_CATALOGS: CatalogItem[] = [
  { id: 'phim-le', name: 'Phim Lẻ', type: 'movie', posterShape: 'landscape', apiPath: 'danh-sach/phim-le', defaultChecked: true },
  { id: 'phim-4k', name: 'Phim Lẻ TM', type: 'movie', posterShape: 'landscape', apiPath: 'danh-sach/phim-chieu-rap', defaultChecked: true },
  { id: 'phim-moi-cap-nhat', name: 'Phim Mới', type: 'movie', posterShape: 'landscape', apiPath: 'danh-sach/phim-moi-cap-nhat', defaultChecked: true },
  { id: 'phim-bo', name: 'Phim Bộ', type: 'series', posterShape: 'landscape', apiPath: 'danh-sach/phim-bo', defaultChecked: true },
  { id: 'phim-thieu-nhi', name: 'Thiếu Nhi', type: 'movie', posterShape: 'landscape', apiPath: 'the-loai/hoat-hinh', defaultChecked: true },
  { id: 'phim-le-thuyet-minh', name: 'Phim Thuyết Minh', type: 'movie', posterShape: 'landscape', apiPath: 'danh-sach/phim-thuyet-minh', defaultChecked: true },
  { id: 'bxh-phim-thang', name: 'BXH Phim Tháng', type: 'movie', posterShape: 'landscape', apiPath: 'danh-sach/phim-moi-cap-nhat', defaultChecked: true },
  { id: 'phim-chieu-rap', name: 'Phim Chiếu Rạp', type: 'movie', posterShape: 'landscape', apiPath: 'danh-sach/phim-chieu-rap', defaultChecked: true },
  { id: 'hanh-dong', name: 'Hành Động / Phiêu Lưu', type: 'movie', posterShape: 'landscape', apiPath: 'the-loai/hanh-dong', defaultChecked: true },
  { id: 'kinh-di', name: 'Kinh Dị / Giật Gân', type: 'movie', posterShape: 'landscape', apiPath: 'the-loai/kinh-di', defaultChecked: true },
  { id: 'au-my', name: 'Phim Âu Mỹ', type: 'movie', posterShape: 'landscape', apiPath: 'quoc-gia/au-my', defaultChecked: true },
  { id: 'han-trung', name: 'Hàn Quốc / Trung Quốc', type: 'series', posterShape: 'landscape', apiPath: 'quoc-gia/han-quoc', defaultChecked: true },
  { id: 'vo-thuat-long-tieng', name: 'Võ Thuật / Lồng Tiếng', type: 'movie', posterShape: 'landscape', apiPath: 'the-loai/vo-thuat', defaultChecked: true },
  { id: 'khoa-hoc-vien-tuong', name: '🛸 Khoa Học Viễn Tưởng', type: 'movie', posterShape: 'landscape', apiPath: 'the-loai/vien-tuong', defaultChecked: true },
  { id: 'hoat-hinh-anime', name: 'Hoạt Hình & Anime', type: 'series', posterShape: 'landscape', apiPath: 'danh-sach/hoat-hinh', defaultChecked: true },
];

export const DEFAULT_ADULT_CATALOGS: CatalogItem[] = [
  {
    id: 'phim_18_series',
    name: '🔞 Series JUQ, STAR...',
    type: 'movie',
    tag: 'Series Độc Quyền',
    primaryKw: 'JUQ',
    secondaryKw: 'STAR',
    keywords: ['JUQ', 'STAR', 'SSIS', 'IPX', 'MIDE', 'FSDSS', 'PRED', 'WANZ'],
  },
  {
    id: 'phim_18_massage',
    name: '🔞 Massage thư giãn',
    type: 'movie',
    tag: 'Massage thư giãn',
    primaryKw: 'エステ',
    secondaryKw: 'マッサージ',
    keywords: ['エステ', 'マッサージ', '油压', 'SPA', '按摩'],
  },
  {
    id: 'phim_18_vung_trom',
    name: '🔞 Vụng trộm / Kịch tính',
    type: 'movie',
    tag: 'Vụng trộm / Kịch tính',
    primaryKw: '不倫',
    secondaryKw: '寝取',
    keywords: ['不倫', '寝取', '人妻', '偷情', '出轨'],
  },
  {
    id: 'phim_18_bo_chong',
    name: '🔞 Bố chồng / Con dâu',
    type: 'movie',
    tag: 'Bố chồng / Con dâu',
    primaryKw: '公公',
    secondaryKw: '儿媳',
    keywords: ['公公', '儿媳', '義父', '義母', '丈母娘'],
  },
];
