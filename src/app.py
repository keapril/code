import streamlit as st
import pandas as pd
import re
import os
import json
from datetime import datetime, timedelta
import time
import io
import s3fs

# --- 1. 設定頁面配置 ---
st.set_page_config(
    page_title="醫療產品查詢系統", 
    layout="wide", 
    page_icon="🌿"
)

# --- 2. 設定：醫院白名單設定 (全域設定) ---

# A. 公開顯示 (南區醫院)
PUBLIC_HOSPITALS = [
    "大林慈濟", "中國(祐新/銀鐸)", "中國北港(祐新/銀鐸)", "中國安南(祐新/銀鐸)", "中國新竹(祐新/銀鐸)",
    "中榮", "天主教聖馬爾定醫院", "台南市立(秀傳)", "右昌", "台南新樓", "成大", "秀傳", "阮綜合",
    "奇美永康", "奇美佳里", "奇美柳營", "東港安泰", "枋寮醫院", "屏東榮民總醫院", "屏東寶建", "屏基",
    "高雄大同(長庚)", "高雄小港(高醫)", "高雄市立民生醫院", "高雄市立聯合醫院", "高雄岡山(高醫)",
    "高雄長庚", "高雄榮民總醫院臺南分院", "高榮", "高醫", "健仁", "國軍左營", "國軍高雄",
    "國軍高雄總醫院屏東分院", "郭綜合", "麻豆新樓", "義大", "嘉基", "嘉義長庚", "嘉義陽明",
    "臺南新樓", "輔英(可用彰基院內碼)", "衛生福利部屏東醫院", "衛生福利部恆春旅遊醫院",
    "衛生福利部新營醫院", "衛生福利部嘉義醫院", "衛生福利部旗山醫院", "衛生福利部臺南醫院",
    "衛生福利部澎湖醫院"
]

# B. 噥噥專用 (特定醫院)
MANAGER_HOSPITALS = [
    "新店慈濟", "台北慈濟", 
    "內湖三總", "三軍總醫院", 
    "松山三總", "松山分院", 
    "國立陽明大學",          
    "國立陽明交通大學",      
    "交通大學",              
    "輔大", "羅東博愛", 
    "衛生福利部臺北醫院", "部立臺北"
]

# C. 合併清單
ALL_VALID_HOSPITALS = PUBLIC_HOSPITALS + MANAGER_HOSPITALS

# R2 設定檔案路徑
R2_PARQUET_PATH = "medical_products.parquet"
R2_METADATA_PATH = "metadata.json"

# --- 3. CSS 樣式優化 ---
st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=Lato:wght@300;400;700&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

    :root {
        --bg-color: #F9F9F7;
        --sidebar-bg: #F0EFEB;
        --text-main: #4A4A4A;
        --accent-color: #6D8B74;
        --border-color: #D3D3D3;
        --font-serif: 'Noto Serif TC', serif;
        --font-sans: 'Lato', sans-serif;
    }

    .stApp { background-color: var(--bg-color); color: var(--text-main); }
    /* 修正：針對內容區域設定字體，避免干擾內建圖示 */
    .main .block-container, [data-testid="stSidebarContent"] { font-family: var(--font-sans); }
    [data-testid="stSidebar"] { background-color: var(--sidebar-bg); border-right: 1px solid #E5E5E5; }
    
    /* 確保 Material Symbols 圖示正常顯示 */
    .stApp [data-testid="stIconMaterial"], .stApp i, .stApp span[class*="material"] {
        font-family: 'Material Symbols Outlined' !important;
    }
    h1, h2, h3 { font-family: var(--font-serif) !important; color: #2C3639 !important; font-weight: 700; letter-spacing: 0.05em; }

    .main-header { font-size: 2.5rem; border-bottom: 2px solid var(--accent-color); padding-bottom: 10px; margin-bottom: 20px; text-align: center; }
    .sub-header { font-size: 1rem; color: #888; text-align: center; margin-top: -15px; margin-bottom: 30px; font-family: var(--font-sans); text-transform: uppercase; letter-spacing: 0.15em; }

    .stTextInput input, .stSelectbox div[data-baseweb="select"] > div, .stMultiSelect div[data-baseweb="select"] > div {
        background-color: #FFFFFF !important; border: 1px solid var(--border-color) !important; border-radius: 4px !important; color: var(--text-main) !important; box-shadow: none !important;
    }
    .stTextInput input:focus, div[data-baseweb="select"] > div:focus-within { border-color: var(--accent-color) !important; }

    div[data-testid="stForm"] button {
        background-color: transparent !important; color: var(--accent-color) !important; border: 1px solid var(--accent-color) !important; border-radius: 0px !important; font-family: var(--font-serif); letter-spacing: 1px; transition: all 0.3s ease; padding: 8px 16px;
    }
    div[data-testid="stForm"] button:hover { background-color: var(--accent-color) !important; color: white !important; }

    div[data-testid="stDataFrame"] { background-color: transparent; }
    #MainMenu {visibility: hidden;} footer {visibility: hidden;}
    .stCheckbox label span { font-family: var(--font-serif); color: #555; }
    .streamlit-expanderHeader { background-color: transparent !important; color: var(--text-main) !important; font-family: var(--font-serif); }
    </style>
""", unsafe_allow_html=True)

# --- 4. 資料處理核心邏輯 ---
def process_data(df):
    try:
        # 基礎清理
        df = df.dropna(how='all').dropna(axis=1, how='all').reset_index(drop=True)
        df = df.astype(str).apply(lambda x: x.str.strip())
        
        # 自動偵測標題列
        header_col_idx = -1
        for c in range(min(15, df.shape[1])):
            if df.iloc[:, c].astype(str).apply(lambda x: '型號' in x).any():
                header_col_idx = c
                break
        
        if header_col_idx == -1:
            return None, "錯誤：無法偵測標題欄 (找不到『型號』)。"

        header_col_data = df.iloc[:, header_col_idx]

        def find_row_index(keywords):
            if isinstance(keywords, str): keywords = [keywords]
            for kw in keywords:
                matches = header_col_data[header_col_data == kw]
                if not matches.empty: return matches.index[0]
                matches = header_col_data[header_col_data.str.replace(' ', '') == kw]
                if not matches.empty: return matches.index[0]
                matches = header_col_data[header_col_data.str.contains(kw, na=False) & (header_col_data.str.len() < 20)]
                if not matches.empty: return matches.index[0]
            return None

        idx_model = find_row_index('型號')
        idx_alias = find_row_index(['客戶簡稱', '產品名稱', '品名']) 
        idx_nhi_code = find_row_index(['健保碼', '自費碼', '健保碼(自費碼)'])
        idx_permit = find_row_index('許可證')
        
        if idx_model is None:
            return None, "錯誤：找不到『型號』列。"

        # 建構產品清單
        products = {}
        for col_idx in range(header_col_idx + 1, df.shape[1]):
            model_val = str(df.iloc[idx_model, col_idx]).strip()
            
            if (model_val == '' or model_val.lower() == 'nan' or 
                '祐新' in model_val or '銀鐸' in model_val or len(model_val) > 2000):
                continue
            
            alias_val = df.iloc[idx_alias, col_idx] if idx_alias is not None else ''
            
            if alias_val.strip().upper() == 'ACP':
                continue
                
            nhi_val = df.iloc[idx_nhi_code, col_idx] if idx_nhi_code is not None else ''
            permit_val = df.iloc[idx_permit, col_idx] if idx_permit is not None else ''
            
            # --- Bug 修復：型號拆分邏輯 ---
            # 支援分號、逗號、換行拆分型號，讓每個型號都能被單獨精準搜尋
            split_models = [m.strip() for m in re.split(r'[;,\n\r]', model_val) if m.strip()]
            if not split_models: split_models = [model_val]
            
            model_entries = []
            for m in split_models:
                m_clean = re.sub(r'[^a-zA-Z0-9]', '', m)
                model_entries.append({
                    'name': m,
                    'search_string': f"{m} {m_clean} {alias_val} {nhi_val} {permit_val}".lower()
                })

            products[col_idx] = {
                'entries': model_entries,
                '產品名稱': alias_val,
                '健保碼': nhi_val
            }
        
        known_indices = [i for i in [idx_model, idx_alias, idx_nhi_code, idx_permit] if i is not None]
        exclude_keys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證']
        
        processed_list = []

        for row_idx, row in df.iterrows():
            row_header = str(row.iloc[header_col_idx])
            
            if (row_header == '' or row_header.lower() == 'nan') and header_col_idx > 0:
                prev_val = str(row.iloc[header_col_idx - 1])
                if prev_val and prev_val.lower() != 'nan':
                    row_header = prev_val

            if row_idx in known_indices: continue
            if row_header == '' or row_header.lower() == 'nan': continue
            if any(k in row_header for k in exclude_keys): continue
            
            hospital_name = row_header.strip()
            hospital_name = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', hospital_name)
            hospital_name = hospital_name.replace('　', ' ') 
            
            is_valid = False
            
            if "國立陽明" in hospital_name:
                is_valid = True
            else:
                for v_hosp in ALL_VALID_HOSPITALS:
                    if v_hosp == hospital_name:
                        is_valid = True
                        break
                    if len(v_hosp) > 1 and v_hosp in hospital_name:
                        is_valid = True
                        break
            
            if not is_valid: continue 

            for col_idx, p_info in products.items():
                cell_content = str(row.iloc[col_idx])
                
                if cell_content and str(cell_content).strip() != '' and str(cell_content).lower() != 'nan':
                    
                    # 支援 # 和 $ 兩種符號（$ 通常代表價格，但後面可能跟著日期）
                    pattern = r'([#$]\s*[A-Za-z0-9\-\.\_]+)'
                    all_matches = re.findall(pattern, cell_content)
                    
                    found_relevant_matches = []
                    if all_matches:
                        if "台南市立" in hospital_name or "秀傳" in hospital_name:
                            hosp_codes = []
                            bill_codes = []
                            spec_model_update = None
                            
                            for code in all_matches:
                                clean_code = code.replace('#', '').replace('$', '').strip()
                                if clean_code.upper().startswith('B'):
                                    hosp_codes.append(clean_code)
                                elif clean_code[0].isdigit(): 
                                    spec_model_update = clean_code
                                else:
                                    bill_codes.append(clean_code)
                            
                            found_relevant_matches = [{
                                '院內碼': ", ".join(hosp_codes),
                                '批價碼': ", ".join(bill_codes),
                                '額外型號': spec_model_update
                            }]
                        else:
                            # 以 # 為分界點，將內容切分為多個院內碼區塊
                            # 這樣可以確保 #院內碼 之後的所有內容（包含 $ 價格行）都被歸類到該院內碼下
                            # 例如：#21869302\n$40350(113/8/7議價) 會被視為一個區塊
                            pattern_blocks = r'#\s*([A-Za-z0-9\-\.\_]+)([^#]*?)(?=#|$)'
                            matches = re.findall(pattern_blocks, cell_content, re.DOTALL)
                            
                            # 收集所有院內碼候選項
                            all_code_candidates = []
                            
                            if matches:
                                for code, context_text in matches:
                                    code = code.strip()
                                    
                                    # 尋找日期（遍歷該區塊內的所有內容，包含 $ 價格行）
                                    # 增強型正則：支援空格、點號、斜線、橫線，例如 113 / 8 / 7 或 113.8.7
                                    date_val = 0
                                    all_dates = re.findall(r'(\d{2,4})\s*[/\.\-]\s*(\d{1,2})\s*[/\.\-]\s*(\d{1,2})', context_text)
                                    if all_dates:
                                        for y_str, m_str, d_str in all_dates:
                                            y = int(y_str)
                                            m = int(m_str)
                                            d = int(d_str)
                                            if 10 <= y < 1000: y += 1911
                                            elif y < 100: y += 2000
                                            current_date = y * 10000 + m * 100 + d
                                            if current_date > date_val:
                                                date_val = current_date
                                    
                                    # 提取括號內容（用於智慧配對）
                                    bracket_model = None
                                    bracket_contents = re.findall(r'\(([^)]+)\)', context_text)
                                    for bracket_text in bracket_contents:
                                        bracket_text = bracket_text.strip()
                                        # 只提取字母數字組合，排除日期和中文
                                        if (re.match(r'^[A-Za-z0-9\-]+$', bracket_text) and 
                                            not re.match(r'^\d{2,4}[/\.\-]\d{1,2}', bracket_text)):
                                            bracket_model = bracket_text
                                            break
                                    
                                    all_code_candidates.append({
                                        '院內碼': code,
                                        '批價碼': '',
                                        '日期': date_val,
                                        '括號內容': bracket_model
                                    })
                            
                            # 優先選擇策略：根據括號內容分組後再進行日期優先選擇
                            # 不同括號內容 = 不同產品，不應互相排除
                            groups = {}
                            for candidate in all_code_candidates:
                                bracket_key = candidate.get('括號內容') or ''
                                if bracket_key not in groups:
                                    groups[bracket_key] = []
                                groups[bracket_key].append(candidate)
                            
                            final_matches = []
                            for bracket, candidates in groups.items():
                                codes_with_date = [c for c in candidates if c['日期'] > 0]
                                if codes_with_date:
                                    # 選擇該分組內日期最新的
                                    best = max(codes_with_date, key=lambda x: x['日期'])
                                    final_matches.append(best)
                                else:
                                    # 該分組內都沒日期，全部保留
                                    final_matches.extend(candidates)
                            
                            found_relevant_matches = final_matches if final_matches else []
                    else:
                        found_relevant_matches = [{'院內碼': '', '批價碼': ''}]

                    # 建立產品型號集合（用於智慧括號配對）
                    product_model_set = {entry['name'] for entry in p_info['entries']}
                    
                    # 為每個拆分後的產品型號建立對應的項目
                    # 智慧括號配對：只有當括號內容完全吻合產品型號時才精確配對
                    for p_entry in p_info['entries']:
                        for match in found_relevant_matches:
                            if not match.get('院內碼'):
                                continue
                            
                            # 檢查括號內容是否為產品型號
                            bracket_content = match.get('括號內容')
                            
                            if bracket_content and bracket_content in product_model_set:
                                # 括號內容是產品型號：精確配對
                                # 例如：#1809411(610132) 只配對型號 610132
                                if bracket_content == p_entry['name']:
                                    final_item = {
                                        '醫院名稱': hospital_name,
                                        '型號': p_entry['name'],
                                        '產品名稱': p_info['產品名稱'],
                                        '健保碼': p_info['健保碼'],
                                        '院內碼': match['院內碼'],
                                        '批價碼': match.get('批價碼', ''), 
                                        '原始備註': cell_content,
                                        '搜尋用字串': p_entry['search_string'],
                                        '日期': match.get('日期', 0)
                                    }
                                    processed_list.append(final_item)
                                # else: 型號不吻合，跳過
                            else:
                                # 括號內容不是產品型號（或沒有括號）：配對所有型號
                                # 例如：#21869302 或 #123456(祐新) 配對所有型號
                                final_item = {
                                    '醫院名稱': hospital_name,
                                    '型號': p_entry['name'],
                                    '產品名稱': p_info['產品名稱'],
                                    '健保碼': p_info['健保碼'],
                                    '院內碼': match['院內碼'],
                                    '批價碼': match.get('批價碼', ''), 
                                    '原始備註': cell_content,
                                    '搜尋用字串': p_entry['search_string'],
                                    '日期': match.get('日期', 0)
                                }
                                processed_list.append(final_item)


        # 去除完全重複的項目（可能因為多個產品欄位導致）
        df_result = pd.DataFrame(processed_list)
        if not df_result.empty:
            # 先根據「醫院+產品+型號」分組，每組只保留日期最新的院內碼
            # 這樣可以確保高醫等醫院不會顯示舊的院內碼
            df_result = df_result.sort_values('日期', ascending=False)
            df_result = df_result.drop_duplicates(
                subset=['醫院名稱', '產品名稱', '型號'], 
                keep='first'  # 保留第一個（日期最新）
            )
            # 移除日期欄位（不需要顯示給使用者）
            if '日期' in df_result.columns:
                df_result = df_result.drop(columns=['日期'])
        
        return df_result, None

    except Exception as e:
        return None, f"處理錯誤: {str(e)}"

# === Cloudflare R2 儲存與讀取函式 ===

def get_r2_fs():
    """初始化 S3FS 連線 (用於 R2)"""
    try:
        r2_config = st.secrets["r2"]
        fs = s3fs.S3FileSystem(
            key=r2_config["access_key_id"],
            secret=r2_config["secret_access_key"],
            endpoint_url=r2_config["endpoint_url"]
        )
        return fs, r2_config["bucket_name"]
    except Exception as e:
        st.error(f"R2 連線配置錯誤: {e}")
        return None, None

def save_data_to_r2(df, updated_at, file_name):
    """將 DataFrame 轉為 Parquet 上傳至 R2"""
    fs, bucket = get_r2_fs()
    if not fs: return False
    
    try:
        # 1. 儲存 Parquet 資料檔
        parquet_key = f"{bucket}/{R2_PARQUET_PATH}"
        with fs.open(parquet_key, 'wb') as f:
            df.to_parquet(f, index=False, engine='pyarrow')
            
        # 2. 儲存中繼資料 (JSON)
        meta_key = f"{bucket}/{R2_METADATA_PATH}"
        metadata = {
            'updated_at': updated_at,
            'file_name': file_name,
            'record_count': len(df)
        }
        with fs.open(meta_key, 'w') as f:
            json.dump(metadata, f)
            
        return True
    except Exception as e:
        st.error(f"上傳至 R2 失敗: {e}")
        return False

@st.cache_data(ttl=600, show_spinner=False)
def load_data_from_r2():
    """從 R2 讀取 Parquet 並恢復"""
    fs, bucket = get_r2_fs()
    if not fs: return None
    
    try:
        parquet_key = f"{bucket}/{R2_PARQUET_PATH}"
        meta_key = f"{bucket}/{R2_METADATA_PATH}"
        
        if fs.exists(parquet_key) and fs.exists(meta_key):
            # 讀取中繼資料
            with fs.open(meta_key, 'r') as f:
                meta = json.load(f)
            
            # 讀取 Parquet
            with fs.open(parquet_key, 'rb') as f:
                df = pd.read_parquet(f, engine='pyarrow')
                
            return {
                'df': df, 
                'updated_at': meta.get('updated_at', '未知'),
                'file_name': meta.get('file_name', '未知檔案')
            }
        return None
    except Exception as e:
        st.error(f"從 R2 讀取失敗: {e}")
        return None

def clear_r2_data():
    """清除 R2 資料"""
    fs, bucket = get_r2_fs()
    if not fs: return False
    try:
        parquet_key = f"{bucket}/{R2_PARQUET_PATH}"
        meta_key = f"{bucket}/{R2_METADATA_PATH}"
        if fs.exists(parquet_key): fs.rm(parquet_key)
        if fs.exists(meta_key): fs.rm(meta_key)
        return True
    except Exception as e:
        st.error(f"清除 R2 失敗: {e}")
        return False

def filter_hospitals(all_hospitals, allow_list):
    filtered = []
    for h in all_hospitals:
        if "聯醫" in h or "北市聯醫" in h:
            continue

        for allow in allow_list:
            if allow == h or allow in h:
                filtered.append(h)
                break 
    return sorted(list(set(filtered)))

# --- 5. 主程式 ---
def main():
    if 'data' not in st.session_state:
        db_content = load_data_from_r2()
        if isinstance(db_content, dict):
            st.session_state.data = db_content.get('df')
            st.session_state.last_updated = db_content.get('updated_at', "未知")
            st.session_state.file_version = db_content.get('file_name', "未知版本")
        else:
            st.session_state.data = None
            st.session_state.last_updated = ""
            st.session_state.file_version = ""

    # 初始化其他變數
    if 'has_searched' not in st.session_state: st.session_state.has_searched = False
    if 'qry_hosp' not in st.session_state: st.session_state.qry_hosp = []
    if 'qry_code' not in st.session_state: st.session_state.qry_code = ""
    if 'qry_key' not in st.session_state: st.session_state.qry_key = ""
    if 'is_manager_mode' not in st.session_state: st.session_state.is_manager_mode = False

    # --- 側邊欄 ---
    with st.sidebar:
        st.markdown("### 🗂️ 查詢目錄")
        
        if st.session_state.last_updated:
            st.caption(f"Last updated: {st.session_state.last_updated}")
            if hasattr(st.session_state, 'file_version') and st.session_state.file_version:
                st.caption(f"Version: {st.session_state.file_version}")
        
        st.markdown("---")
        
        # Admin 模式開關
        c_mode, c_pwd = st.columns([1, 2])
        with c_mode:
            show_manager = st.checkbox("Admin", value=st.session_state.is_manager_mode)
        
        if show_manager and not st.session_state.is_manager_mode:
            m_pwd = st.text_input("Password", type="password", key="manager_pwd_input", label_visibility="collapsed", placeholder="Key")
            if m_pwd == "163": 
                st.session_state.is_manager_mode = True
                st.rerun()
            elif m_pwd:
                st.error("Invalid")
        elif not show_manager and st.session_state.is_manager_mode:
             st.session_state.is_manager_mode = False
             st.rerun()

        if st.session_state.data is not None and not st.session_state.data.empty:
            df = st.session_state.data
            all_db_hospitals = df['醫院名稱'].unique().tolist()
            display_hosp_list = filter_hospitals(all_db_hospitals, MANAGER_HOSPITALS if st.session_state.is_manager_mode else PUBLIC_HOSPITALS)
            
            mode = st.radio("Display Mode", ["Single", "Multiple"], index=0, horizontal=True)
            
            with st.form("search_form"):
                st.markdown("#### 01. 選擇醫院")
                if "Single" in mode:
                    hosp_options = ["(All Hospitals)"] + display_hosp_list
                    default_idx = 0
                    if st.session_state.qry_hosp and len(st.session_state.qry_hosp) == 1:
                        if st.session_state.qry_hosp[0] in hosp_options:
                            default_idx = hosp_options.index(st.session_state.qry_hosp[0])
                    s_hosp_single = st.selectbox("Hospital", options=hosp_options, index=default_idx, label_visibility="collapsed")
                    s_hosp = [s_hosp_single] if s_hosp_single != "(All Hospitals)" else []
                else:
                    default_opts = [h for h in st.session_state.qry_hosp if h in display_hosp_list]
                    s_hosp = st.multiselect("Hospital", options=display_hosp_list, default=default_opts, label_visibility="collapsed")
                
                st.markdown("#### 02. 輸入代碼")
                s_code = st.text_input("Code", value=st.session_state.qry_code, placeholder="院內碼", label_visibility="collapsed")
                
                st.markdown("#### 03. 關鍵字")
                s_key = st.text_input("Keywords", value=st.session_state.qry_key, placeholder="型號 / 產品名", label_visibility="collapsed")
                
                st.markdown("<br>", unsafe_allow_html=True)
                
                c1, c2 = st.columns(2)
                with c1: btn_search = st.form_submit_button("SEARCH")
                with c2: btn_clear = st.form_submit_button("RESET")
            
            if btn_search:
                st.session_state.qry_hosp = s_hosp; st.session_state.qry_code = s_code; st.session_state.qry_key = s_key
                st.session_state.has_searched = True; st.rerun()
            if btn_clear:
                st.session_state.qry_hosp = []; st.session_state.qry_code = ""; st.session_state.qry_key = ""; st.session_state.has_searched = False; st.rerun()
        else:
            st.info("No database initialized.")

        st.markdown("---")
        
        # 資料維護區
        with st.expander("⚙️ Settings"):
            if st.button("Clear R2 Database"):
                if clear_r2_data():
                    load_data_from_r2.clear()  # 清除快取
                    st.session_state.data = None
                    st.success("R2 資料庫已清除")
                    st.rerun()

            password = st.text_input("Key", type="password", placeholder="Upload Password")
            if password == "197": 
                uploaded_file = st.file_uploader("Upload Excel/CSV", type=['xlsx', 'csv'])
                if uploaded_file:
                    # 顯示確認按鈕，打斷無限 Rerun 迴圈
                    st.info(f"已選取檔案：{uploaded_file.name}")
                    if st.button("🚀 確認更新資料庫"):
                        with st.spinner('Processing...'):
                            if uploaded_file.name.endswith('.csv'):
                                try: df_raw = pd.read_csv(uploaded_file, header=None)
                                except: uploaded_file.seek(0); df_raw = pd.read_csv(uploaded_file, header=None, encoding='big5')
                            else: df_raw = pd.read_excel(uploaded_file, engine='openpyxl', header=None)
                            
                            clean_df, error = process_data(df_raw)
                            if clean_df is not None:
                                update_time = (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")
                                file_name = uploaded_file.name
                                
                                if save_data_to_r2(clean_df, update_time, file_name):
                                    load_data_from_r2.clear()  # 清除快取
                                    st.session_state.data = clean_df
                                    st.session_state.last_updated = update_time
                                    st.session_state.file_version = file_name
                                    st.success(f"✅ 已上傳 {len(clean_df)} 筆資料到 Cloudflare R2")
                                    time.sleep(1) # 讓使用者看一下成功訊息
                                    st.rerun()
                            else: 
                                st.error(error)

    # --- 主畫面 ---
    st.markdown('<div class="main-header">醫療產品查詢系統</div>', unsafe_allow_html=True)
    st.markdown('<div class="sub-header">Medical Product Database</div>', unsafe_allow_html=True)

    if st.session_state.data is not None and not st.session_state.data.empty:
        if st.session_state.has_searched:
            df = st.session_state.data
            filtered_df = df.copy()

            all_db_hospitals = df['醫院名稱'].unique().tolist()
            allowed_list = filter_hospitals(all_db_hospitals, MANAGER_HOSPITALS if st.session_state.is_manager_mode else PUBLIC_HOSPITALS)
            filtered_df = filtered_df[filtered_df['醫院名稱'].isin(allowed_list)]

            if st.session_state.qry_hosp: filtered_df = filtered_df[filtered_df['醫院名稱'].isin(st.session_state.qry_hosp)]
            if st.session_state.qry_code:
                k = st.session_state.qry_code.strip()
                filtered_df = filtered_df[filtered_df['院內碼'].str.contains(k, case=False, na=False) | filtered_df['批價碼'].str.contains(k, case=False, na=False) | filtered_df['原始備註'].str.contains(k, case=False, na=False)]
            if st.session_state.qry_key:
                kws = st.session_state.qry_key.split()
                for k in kws:
                    k_clean = re.sub(r'[^a-zA-Z0-9]', '', k)
                    # Bug 修復：將 regex 設為 False，避免型號內的正則符號 (如括號) 導致搜尋失敗
                    m = (filtered_df['搜尋用字串'].str.contains(k, case=False, na=False, regex=False) | 
                         filtered_df['原始備註'].str.contains(k, case=False, na=False, regex=False) | 
                         filtered_df['醫院名稱'].str.contains(k, case=False, na=False, regex=False))
                    if k_clean: 
                        m = m | filtered_df['搜尋用字串'].str.contains(k_clean, case=False, na=False, regex=False)
                    filtered_df = filtered_df[m]

            # 顯示結果
            if not filtered_df.empty:
                st.markdown(f"**Results:** {len(filtered_df)} items found")
                display_cols = ['醫院名稱', '產品名稱', '型號', '院內碼', '批價碼']
                
                styled_df = filtered_df[display_cols].style\
                    .set_properties(**{
                        'background-color': '#FFFFFF',
                        'color': '#4A4A4A',
                        'border-color': '#E0E0E0',
                        'font-family': "'Lato', sans-serif"
                    })\
                    .set_table_styles([
                        {'selector': 'th', 'props': [('background-color', '#F0EFEB'), ('color', '#2C3639'), ('font-family', "'Noto Serif TC', serif"), ('font-weight', 'bold'), ('border-bottom', '2px solid #6D8B74')]},
                        {'selector': 'td', 'props': [('padding', '12px 10px')]}
                    ])\
                    .applymap(lambda v: 'color: #6D8B74; font-weight: bold;', subset=['醫院名稱'])
                
                st.dataframe(styled_df, use_container_width=True, hide_index=True, height=700)
            else:
                st.markdown("""
                    <div style="text-align: center; padding: 50px; color: #888;">
                        <h3 style="color: #AAA;">NO RESULTS</h3>
                        <p>請嘗試更換關鍵字或選擇其他醫院</p>
                    </div>
                """, unsafe_allow_html=True)
        else:
            # 歡迎/引導畫面
            st.markdown("""
                <div style="background-color: #FFFFFF; padding: 40px; border-radius: 8px; border: 1px solid #EAEAEA; text-align: center;">
                    <h3 style="color: #6D8B74;">Welcome</h3>
                    <p style="color: #666; font-size: 14px; line-height: 1.6;">
                        請由左側選單選擇醫院或輸入關鍵字。<br>
                        支援型號、產品名稱與院內碼的複合搜尋。
                    </p>
                    <hr style="width: 50px; margin: 20px auto; border-top: 2px solid #E0E0E0;">
                </div>
            """, unsafe_allow_html=True)
    else:
        st.warning("⚠️ 請先於左側 Settings 上傳資料庫檔案")

if __name__ == "__main__":
    main()
