import streamlit as st
import pandas as pd
import re
import os
import pickle
from datetime import datetime
import time

# --- 1. 設定頁面配置 (雜誌風標題) ---
st.set_page_config(
    page_title="Medical Product Database", 
    layout="wide", 
    page_icon="🌿"
)

# --- 2. 設定：醫院白名單 (維持原邏輯) ---

PUBLIC_HOSPITALS = [
    "成大", "台南市立(秀傳)", 
    "麻豆新樓", "臺南新樓", "安南新樓",
    "衛生福利部新營醫院", "衛生福利部嘉義醫院", "衛生福利部臺南醫院", "衛生福利部澎湖醫院",
    "奇美永康", "奇美佳里", "奇美柳營", 
    "嘉基", "嘉義陽明", "嘉榮", 
    "國軍高雄", "國軍高雄總醫院屏東分院", "國軍高雄總醫院岡山分院", 
    "義大", "高雄大同(長庚)", "高雄小港(高醫)", 
    "高雄市立民生醫院", "高雄市立聯合醫院", "高雄岡山(高醫)", 
    "高雄長庚", "高醫", 
    "屏東榮民總醫院", "屏東寶建", "屏基", 
    "衛生福利部屏東醫院", "衛生福利部恆春旅遊醫院", 
    "輔英", "阮綜合", "健仁", "右昌", "東港安泰", "郭綜合",
    "中國安南"
]

MANAGER_HOSPITALS = [
    "新店慈濟", "台北慈濟", 
    "內湖三總", "三軍總醫院", 
    "松山三總", "松山分院", 
    "國立陽明大學", "國立陽明交通大學附設醫院", "國立陽明",
    "輔大", "羅東博愛", 
    "衛生福利部臺北醫院", "部立臺北"
]

ALL_VALID_HOSPITALS = PUBLIC_HOSPITALS + MANAGER_HOSPITALS
DB_FILE = 'local_database.pkl'

# --- 3. CSS 樣式優化 (核心美化部分) ---
st.markdown("""
    <style>
    /* 引入 Google Fonts: Noto Serif TC (宋體/襯線體) */
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=Lato:wght@300;400;700&display=swap');

    /* === 全域變數定義 === */
    :root {
        --bg-color: #F9F9F7;        /* 暖米色背景 */
        --sidebar-bg: #F0EFEB;      /* 側邊欄略深 */
        --text-main: #4A4A4A;       /* 深灰文字 */
        --accent-color: #6D8B74;    /* 莫蘭迪綠 */
        --border-color: #D3D3D3;    /* 淺灰框線 */
        --font-serif: 'Noto Serif TC', serif;
        --font-sans: 'Lato', sans-serif;
    }

    /* === 1. 背景與文字基礎 === */
    .stApp {
        background-color: var(--bg-color);
        color: var(--text-main);
        font-family: var(--font-sans);
    }
    
    [data-testid="stSidebar"] {
        background-color: var(--sidebar-bg);
        border-right: 1px solid #E5E5E5;
    }

    h1, h2, h3 {
        font-family: var(--font-serif) !important;
        color: #2C3639 !important;
        font-weight: 700;
        letter-spacing: 0.05em;
    }

    /* 調整標題樣式 */
    .main-header {
        font-size: 2.5rem;
        border-bottom: 2px solid var(--accent-color);
        padding-bottom: 10px;
        margin-bottom: 20px;
        text-align: center;
    }
    
    .sub-header {
        font-size: 1rem;
        color: #888;
        text-align: center;
        margin-top: -15px;
        margin-bottom: 30px;
        font-family: var(--font-sans);
        text-transform: uppercase;
        letter-spacing: 0.15em;
    }

    /* === 2. 輸入框與選單 (極簡化) === */
    .stTextInput input, .stSelectbox div[data-baseweb="select"] > div, .stMultiSelect div[data-baseweb="select"] > div {
        background-color: #FFFFFF !important;
        border: 1px solid var(--border-color) !important;
        border-radius: 4px !important; 
        color: var(--text-main) !important;
        box-shadow: none !important;
    }
    
    /* 聚焦時的邊框色 */
    .stTextInput input:focus, div[data-baseweb="select"] > div:focus-within {
        border-color: var(--accent-color) !important;
    }

    /* === 3. 按鈕 (雜誌風線框按鈕) === */
    div[data-testid="stForm"] button {
        background-color: transparent !important;
        color: var(--accent-color) !important;
        border: 1px solid var(--accent-color) !important;
        border-radius: 0px !important; /* 方形按鈕 */
        font-family: var(--font-serif);
        letter-spacing: 1px;
        transition: all 0.3s ease;
        padding: 8px 16px;
    }

    div[data-testid="stForm"] button:hover {
        background-color: var(--accent-color) !important;
        color: white !important;
    }

    /* === 4. 表格 (Dataframe) 清爽化 === */
    div[data-testid="stDataFrame"] {
        background-color: transparent;
    }
    
    /* 隱藏預設頁腳與選單 */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    
    /* 調整 Checkbox */
    .stCheckbox label span {
        font-family: var(--font-serif);
        color: #555;
    }
    
    /* Expander 樣式 */
    .streamlit-expanderHeader {
        background-color: transparent !important;
        color: var(--text-main) !important;
        font-family: var(--font-serif);
    }
    
    </style>
""", unsafe_allow_html=True)

# --- 4. 資料處理邏輯 (保持原樣，僅壓縮顯示) ---
def process_data(df):
    try:
        df = df.dropna(how='all').dropna(axis=1, how='all').reset_index(drop=True)
        df = df.astype(str).apply(lambda x: x.str.strip())
        
        header_col_idx = -1
        for c in range(min(15, df.shape[1])):
            if df.iloc[:, c].astype(str).apply(lambda x: '型號' in x).any():
                header_col_idx = c
                break
        
        if header_col_idx == -1: return None, "錯誤：無法偵測標題欄 (找不到『型號』)。"
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
        
        if idx_model is None: return None, "錯誤：找不到『型號』列。"

        products = {}
        for col_idx in range(header_col_idx + 1, df.shape[1]):
            model_val = df.iloc[idx_model, col_idx]
            if (model_val == '' or model_val.lower() == 'nan' or '祐新' in model_val or '銀鐸' in model_val or len(model_val) > 50): continue
            
            alias_val = df.iloc[idx_alias, col_idx] if idx_alias is not None else ''
            nhi_val = df.iloc[idx_nhi_code, col_idx] if idx_nhi_code is not None else ''
            permit_val = df.iloc[idx_permit, col_idx] if idx_permit is not None else ''
            model_clean = re.sub(r'[^a-zA-Z0-9]', '', str(model_val))
            products[col_idx] = {'型號': model_val, '產品名稱': alias_val, '健保碼': nhi_val, '搜尋用字串': f"{model_val} {model_clean} {alias_val} {nhi_val} {permit_val}".lower()}
        
        known_indices = [i for i in [idx_model, idx_alias, idx_nhi_code, idx_permit] if i is not None]
        exclude_keys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證']
        processed_list = []

        for row_idx, row in df.iterrows():
            row_header = str(row.iloc[header_col_idx])
            if row_idx in known_indices or row_header == '' or row_header.lower() == 'nan': continue
            if any(k in row_header for k in exclude_keys): continue
            
            hospital_name = row_header.strip()
            is_valid = False
            for v_hosp in ALL_VALID_HOSPITALS:
                if v_hosp == hospital_name or (len(v_hosp) > 1 and v_hosp in hospital_name):
                    is_valid = True; break
            if not is_valid: continue 

            for col_idx, p_info in products.items():
                cell_content = str(row.iloc[col_idx])
                if cell_content and cell_content.lower() != 'nan' and len(cell_content) > 1:
                    pattern = r'(#\s*[A-Za-z0-9\-\.\_]+)'
                    all_matches = re.findall(pattern, cell_content)
                    base_item = {'醫院名稱': hospital_name, '型號': p_info['型號'], '產品名稱': p_info['產品名稱'], '健保碼': p_info['健保碼'], '院內碼': "", '批價碼': "", '原始備註': cell_content, '搜尋用字串': p_info['搜尋用字串']}
                    
                    if all_matches:
                        if "台南市立" in hospital_name or "秀傳" in hospital_name:
                            hosp_codes, bill_codes, spec_model = [], [], None
                            for code in all_matches:
                                c = code.replace('#', '').strip()
                                if c.upper().startswith('B'): hosp_codes.append(c)
                                elif c[0].isdigit(): spec_model = c
                                else: bill_codes.append(c)
                            new_item = base_item.copy()
                            new_item['院內碼'] = ", ".join(hosp_codes); new_item['批價碼'] = ", ".join(bill_codes)
                            if spec_model: new_item['型號'] = spec_model; new_item['搜尋用字串'] += f" {spec_model}"
                            if new_item['院內碼'] or new_item['批價碼'] or spec_model: processed_list.append(new_item)
                            else: processed_list.append(base_item)
                        else:
                            matches_spec = re.findall(r'(#\s*[A-Za-z0-9\-\.\_]+)(?:\s*[\n\r]*\(([^)]+)\))?', cell_content)
                            if matches_spec:
                                for cr, stxt in matches_spec:
                                    ni = base_item.copy(); ni['院內碼'] = cr.replace('#', '').strip()
                                    if stxt:
                                        stxt = stxt.strip()
                                        ex = ['議價', '生效', '發票', '稅', '折讓', '贈', '單', '訂單', '通知', '健保', '關碼', '停用', '缺貨', '取代', '急採', '收費', '月', '年', '日', '/']
                                        if not any(k in stxt for k in ex) and len(stxt) < 50:
                                            ni['型號'] = stxt.split()[0]; ni['搜尋用字串'] += f" {ni['型號'].lower()}"
                                    processed_list.append(ni)
                            else:
                                for code in all_matches:
                                    ni = base_item.copy(); ni['院內碼'] = code.replace('#', '').strip(); processed_list.append(ni)
                    else:
                        processed_list.append(base_item)
        return pd.DataFrame(processed_list), None
    except Exception as e: return None, f"處理錯誤: {str(e)}"

def save_data(data_dict):
    with open(DB_FILE, 'wb') as f: pickle.dump(data_dict, f)

@st.cache_data(ttl=3600, show_spinner=False)
def load_data_cached(mtime):
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'rb') as f: return pickle.load(f)
    return None

def get_data():
    if os.path.exists(DB_FILE): return load_data_cached(os.path.getmtime(DB_FILE))
    return None

def filter_hospitals(all_hospitals, allow_list):
    filtered = []
    for h in all_hospitals:
        for allow in allow_list:
            if "陽明" in allow:
                if "陽明大學" in h or "陽明交通" in h or "國立陽明" in h:
                    if "聯醫" not in h: filtered.append(h); break
                continue
            if allow == h or (len(allow) > 1 and allow in h): filtered.append(h); break
    return sorted(list(set(filtered)))

# --- 5. 主程式 ---
def main():
    db_content = get_data()
    
    if isinstance(db_content, pd.DataFrame):
        st.session_state.data = db_content
        st.session_state.last_updated = "未知"
    elif isinstance(db_content, dict):
        st.session_state.data = db_content.get('df')
        st.session_state.last_updated = db_content.get('updated_at', "未知")
    else:
        st.session_state.data = None
        st.session_state.last_updated = ""

    if 'has_searched' not in st.session_state: st.session_state.has_searched = False
    if 'qry_hosp' not in st.session_state: st.session_state.qry_hosp = []
    if 'qry_code' not in st.session_state: st.session_state.qry_code = ""
    if 'qry_key' not in st.session_state: st.session_state.qry_key = ""
    if 'is_manager_mode' not in st.session_state: st.session_state.is_manager_mode = False

    # --- 側邊欄設計 ---
    with st.sidebar:
        st.markdown("### 🗂️ 查詢目錄")
        
        if st.session_state.last_updated:
            st.caption(f"Last updated: {st.session_state.last_updated}")
        
        st.markdown("---")
        
        # 噥噥模式開關
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

        if st.session_state.data is not None:
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
            if st.button("Clear Database"):
                if os.path.exists(DB_FILE): os.remove(DB_FILE)
                load_data_cached.clear()
                st.session_state.data = None; st.rerun()

            password = st.text_input("Key", type="password", placeholder="Upload Password")
            if password == "197": 
                uploaded_file = st.file_uploader("Upload Excel/CSV", type=['xlsx', 'csv'])
                if uploaded_file:
                    with st.spinner('Processing...'):
                        if uploaded_file.name.endswith('.csv'):
                            try: df_raw = pd.read_csv(uploaded_file, header=None)
                            except: uploaded_file.seek(0); df_raw = pd.read_csv(uploaded_file, header=None, encoding='big5')
                        else: df_raw = pd.read_excel(uploaded_file, engine='openpyxl', header=None)
                        
                        clean_df, error = process_data(df_raw)
                        if clean_df is not None:
                            update_time = datetime.now().strftime("%Y-%m-%d %H:%M")
                            save_data({'df': clean_df, 'updated_at': update_time})
                            load_data_cached.clear()
                            st.session_state.data = clean_df; st.session_state.last_updated = update_time; st.rerun()
                        else: st.error(error)

    # --- 主畫面 ---
    st.markdown('<div class="main-header">醫療產品查詢系統</div>', unsafe_allow_html=True)
    st.markdown('<div class="sub-header">Medical Product Database</div>', unsafe_allow_html=True)

    if st.session_state.data is not None:
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
                    m = filtered_df['搜尋用字串'].str.contains(k, case=False, na=False) | filtered_df['原始備註'].str.contains(k, case=False, na=False) | filtered_df['醫院名稱'].str.contains(k, case=False, na=False)
                    if k_clean: m = m | filtered_df['搜尋用字串'].str.contains(k_clean, case=False, na=False)
                    filtered_df = filtered_df[m]

            # 顯示結果
            if not filtered_df.empty:
                st.markdown(f"**Results:** {len(filtered_df)} items found")
                display_cols = ['醫院名稱', '產品名稱', '型號', '院內碼', '批價碼']
                
                # 使用 Pandas Styler 製作雜誌風表格
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
