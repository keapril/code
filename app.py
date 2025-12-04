import streamlit as st
import pandas as pd
import re
import os
import pickle
from datetime import datetime
import time

# --- 1. 設定頁面配置 ---
st.set_page_config(page_title="醫療產品查詢系統", layout="wide", page_icon="🏥")

# --- 2. 設定：醫院白名單 ---

# A. 南區醫院 (預設顯示)
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

# B. 噥噥專用 (特定北部/其他醫院)
MANAGER_HOSPITALS = [
    "新店慈濟", "內湖三總", "松山三總", 
    "國立陽明大學", "國立陽明交通大學附設醫院", 
    "輔大附醫", "羅東博愛", "衛生福利部臺北醫院"
]

# 合併清單 (後台處理用)
ALL_VALID_HOSPITALS = PUBLIC_HOSPITALS + MANAGER_HOSPITALS

# CSS 樣式優化 (強制淺色無印風 & 按鈕樣式)
st.markdown("""
    <style>
    /* 全局設定 */
    [data-testid="stAppViewContainer"] { background-color: #F5F7F9 !important; color: #2C3E50 !important; }
    [data-testid="stSidebar"] { background-color: #FFFFFF !important; border-right: 1px solid #E0E0E0; }
    h1, h2, h3, h4, h5, h6, p, span, label, div { color: #2C3E50 !important; font-family: sans-serif; }
    
    /* 輸入框 */
    .stTextInput input, .stMultiSelect div[data-baseweb="select"] > div, .stSelectbox div[data-baseweb="select"] > div {
        background-color: #FFFFFF !important;
        border: 1px solid #D0D0D0 !important;
        color: #2C3E50 !important;
    }
    
    /* 表格 */
    .stDataFrame { background-color: #FFFFFF !important; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    
    /* 按鈕樣式 (白底灰字) */
    div[data-testid="stForm"] button {
        background-color: #FFFFFF !important;
        color: #555555 !important;
        border: 1px solid #CCCCCC !important;
        width: 100%;
        font-weight: bold;
        padding: 10px;
        border-radius: 5px;
        transition: 0.2s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    div[data-testid="stForm"] button:hover {
        background-color: #F0F0F0 !important;
        border-color: #999999 !important;
        color: #333333 !important;
    }
    div[data-testid="stForm"] button:active {
        background-color: #E0E0E0 !important;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
    }
    
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# 資料庫路徑
DB_FILE = 'local_database.pkl'

# --- 3. 資料處理核心邏輯 ---
def process_data(df):
    try:
        # 1. 基礎清理
        df = df.dropna(how='all').dropna(axis=1, how='all').reset_index(drop=True)
        df = df.astype(str).apply(lambda x: x.str.strip())
        
        # 2. 自動偵測標題欄位 (找 '型號')
        header_col_idx = -1
        for c in range(min(15, df.shape[1])): # 掃描前15欄
            col_data = df.iloc[:, c]
            # 寬鬆比對：只要格子裡包含 "型號" 兩個字
            if col_data.str.contains('型號', na=False).any():
                header_col_idx = c
                break
        
        if header_col_idx == -1:
            return None, "錯誤：找不到『型號』欄位，請確認 Excel 格式。"

        header_col_data = df.iloc[:, header_col_idx]

        # 輔助函式：找列索引 (支援多個關鍵字)
        def find_row_index(keywords):
            if isinstance(keywords, str): keywords = [keywords]
            for kw in keywords:
                # 1. 精確比對
                matches = header_col_data[header_col_data == kw]
                if not matches.empty: return matches.index[0]
                # 2. 包含比對 (去除空白後)
                matches = header_col_data[header_col_data.str.replace(' ', '').str.contains(kw, na=False)]
                if not matches.empty: return matches.index[0]
            return None

        # 3. 抓取關鍵列索引 (擴充關鍵字以抓取 Phenom)
        idx_model = find_row_index(['型號', 'Model'])
        # 這裡增加了 '產品名稱', '品名'，確保能抓到 Phenom 所在的列
        idx_alias = find_row_index(['客戶簡稱', '產品名稱', '品名', '簡稱']) 
        idx_nhi_code = find_row_index(['健保碼', '自費碼', '健保碼(自費碼)'])
        idx_permit = find_row_index(['許可證'])
        
        if idx_model is None:
            return None, "錯誤：找不到『型號』列。"

        # 4. 建構產品清單
        products = {}
        total_cols = df.shape[1]
        
        for col_idx in range(header_col_idx + 1, total_cols):
            model_val = df.iloc[idx_model, col_idx]
            
            # 過濾無效欄位
            if (model_val == '' or model_val.lower() == 'nan' or 
                '祐新' in model_val or '銀鐸' in model_val or len(model_val) > 50):
                continue
            
            alias_val = df.iloc[idx_alias, col_idx] if idx_alias is not None else ''
            nhi_val = df.iloc[idx_nhi_code, col_idx] if idx_nhi_code is not None else ''
            permit_val = df.iloc[idx_permit, col_idx] if idx_permit is not None else ''
            
            # 建立搜尋字串 (關鍵：把所有資訊串在一起，轉小寫)
            model_clean = re.sub(r'[^a-zA-Z0-9]', '', str(model_val)) # 純英數型號
            full_search_text = f"{model_val} {model_clean} {alias_val} {nhi_val} {permit_val}".lower()

            products[col_idx] = {
                '型號': model_val,
                '產品名稱': alias_val, # 這裡會存入 Phenom
                '健保碼': nhi_val,
                '搜尋用字串': full_search_text
            }
        
        # 5. 提取醫院資料
        known_indices = [i for i in [idx_model, idx_alias, idx_nhi_code, idx_permit] if i is not None]
        exclude_keys = ['效期', 'QSD', '產地', 'Code', 'Listing', 'None', 'Hospital', 'source', '備註', '健保價', '許可證']
        
        processed_list = []

        for row_idx, row in df.iterrows():
            row_header = str(row.iloc[header_col_idx])
            
            if row_idx in known_indices: continue
            if row_header == '' or row_header.lower() == 'nan': continue
            if any(k in row_header for k in exclude_keys): continue
            
            # === 醫院白名單過濾 ===
            hospital_name = row_header.strip()
            is_valid = False
            
            # 檢查是否在任一名單中 (全部都先存起來，前台再決定顯示哪些)
            for v_hosp in ALL_VALID_HOSPITALS:
                if v_hosp == hospital_name:
                    is_valid = True
                    break
                if len(v_hosp) > 2 and v_hosp in hospital_name:
                    is_valid = True
                    break
            
            if not is_valid: continue 

            # 遍歷產品
            for col_idx, p_info in products.items():
                cell_content = str(row.iloc[col_idx])
                
                if cell_content and cell_content.lower() != 'nan' and len(cell_content) > 1:
                    pattern = r'(#\s*[A-Za-z0-9\-\.\_]+)(?:\s*[\n\r]*\(([^)]+)\))?'
                    matches = re.findall(pattern, cell_content)
                    
                    base_item = {
                        '醫院名稱': hospital_name,
                        '型號': p_info['型號'],
                        '產品名稱': p_info['產品名稱'],
                        '健保碼': p_info['健保碼'],
                        '院內碼': "",
                        '原始備註': cell_content,
                        '搜尋用字串': p_info['搜尋用字串']
                    }
                    
                    if matches:
                        for code_raw, spec_text in matches:
                            new_item = base_item.copy()
                            new_item['院內碼'] = code_raw.replace('#', '').strip()
                            processed_list.append(new_item)
                    else:
                        processed_list.append(base_item)

        return pd.DataFrame(processed_list), None

    except Exception as e:
        return None, f"處理錯誤: {str(e)}"

def save_data(data_dict):
    with open(DB_FILE, 'wb') as f: pickle.dump(data_dict, f)

@st.cache_data(ttl=3600, show_spinner=False)
def load_data_cached(mtime):
    if os.path.exists(DB_FILE):
        with open(DB_FILE, 'rb') as f: return pickle.load(f)
    return None

def get_data():
    if os.path.exists(DB_FILE):
        return load_data_cached(os.path.getmtime(DB_FILE))
    return None

def filter_hospitals(all_hospitals, allow_list):
    filtered = []
    for h in all_hospitals:
        for allow in allow_list:
            if allow == h or (len(allow) > 2 and allow in h):
                filtered.append(h)
                break
    return sorted(list(set(filtered)))

# --- 4. 主程式 ---
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
    if 'select_mode' not in st.session_state: st.session_state.select_mode = "single"

    # --- 側邊欄 ---
    with st.sidebar:
        st.title("🔍 查詢條件")
        
        # 顯示資料統計 (DEBUG用：讓使用者知道讀到了幾家醫院)
        if st.session_state.data is not None:
            hosp_count = len(st.session_state.data['醫院名稱'].unique())
            st.caption(f"📊 資料庫：已載入 {hosp_count} 家醫院\n📅 更新：{st.session_state.last_updated}")
        
        # --- 噥噥專用解鎖開關 ---
        show_manager = st.checkbox("🔓 噥噥專用", value=st.session_state.is_manager_mode)
        
        if show_manager and not st.session_state.is_manager_mode:
            m_pwd = st.text_input("請輸入密碼", type="password", key="manager_pwd_input")
            if m_pwd == "163": 
                st.session_state.is_manager_mode = True
                st.success("噥噥模式已啟用")
                time.sleep(0.5)
                st.rerun()
            elif m_pwd:
                st.error("密碼錯誤")
        elif not show_manager and st.session_state.is_manager_mode:
             st.session_state.is_manager_mode = False
             st.rerun()

        st.markdown("---")

        if st.session_state.data is not None:
            df = st.session_state.data
            all_db_hospitals = df['醫院名稱'].unique().tolist()
            
            # 根據模式過濾下拉選單
            if st.session_state.is_manager_mode:
                # 噥噥模式：顯示全部 (含南區 + 噥噥專用)
                # 您提到「打V後可以隱藏南區」，但我建議顯示全部比較彈性，
                # 或者若要嚴格執行「打V只看北部」，請將下一行改為 filter_hospitals(..., MANAGER_HOSPITALS)
                display_hosp_list = filter_hospitals(all_db_hospitals, ALL_VALID_HOSPITALS)
            else:
                # 一般模式：只顯示南區
                display_hosp_list = filter_hospitals(all_db_hospitals, PUBLIC_HOSPITALS)
            
            mode = st.radio("選擇醫院模式", ["單選 (自動收合)", "多選 (比較用)"], index=0, horizontal=True)
            
            with st.form("search_form"):
                if "單選" in mode:
                    hosp_options = ["(全部)"] + display_hosp_list
                    default_idx = 0
                    if st.session_state.qry_hosp and len(st.session_state.qry_hosp) == 1:
                        if st.session_state.qry_hosp[0] in hosp_options:
                            default_idx = hosp_options.index(st.session_state.qry_hosp[0])
                    s_hosp_single = st.selectbox("🏥 選擇醫院", options=hosp_options, index=default_idx)
                    s_hosp = [s_hosp_single] if s_hosp_single != "(全部)" else []
                else:
                    default_opts = [h for h in st.session_state.qry_hosp if h in display_hosp_list]
                    s_hosp = st.multiselect("🏥 選擇醫院", options=display_hosp_list, default=default_opts)
                
                s_code = st.text_input("🔢 院內碼", value=st.session_state.qry_code)
                s_key = st.text_input("🔎 關鍵字 (型號/產品名)", value=st.session_state.qry_key)
                
                st.markdown("---")
                
                c1, c2 = st.columns(2)
                with c1:
                    btn_search = st.form_submit_button("🔍 查詢")
                with c2:
                    btn_clear = st.form_submit_button("❌ 清除")
            
            if btn_search:
                st.session_state.qry_hosp = s_hosp
                st.session_state.qry_code = s_code
                st.session_state.qry_key = s_key
                st.session_state.has_searched = True
                st.rerun()
            
            if btn_clear:
                st.session_state.qry_hosp = []
                st.session_state.qry_code = ""
                st.session_state.qry_key = ""
                st.session_state.has_searched = False
                st.rerun()
        else:
            st.info("系統無資料")

        st.markdown("---")
        
        show_admin_upload = st.checkbox("我是資料維護員 (上傳)")
        if show_admin_upload:
            with st.expander("⚙️ 後台資料更新", expanded=True):
                if st.button("🗑️ 清除舊資料庫 (重置)"):
                    if os.path.exists(DB_FILE):
                        os.remove(DB_FILE)
                        load_data_cached.clear()
                        st.session_state.data = None
                        st.session_state.last_updated = ""
                        st.session_state.has_searched = False
                        st.success("已清除，請重新上傳。")
                        time.sleep(1)
                        st.rerun()

                password = st.text_input("維護密碼", type="password")
                if password == "197": 
                    uploaded_file = st.file_uploader("上傳 Excel", type=['xlsx'])
                    if uploaded_file:
                        with st.spinner('處理中...'):
                            df_raw = pd.read_excel(uploaded_file, engine='openpyxl', header=None)
                            clean_df, error = process_data(df_raw)
                            if clean_df is not None:
                                update_time = datetime.now().strftime("%Y-%m-%d %H:%M")
                                save_data({'df': clean_df, 'updated_at': update_time})
                                load_data_cached.clear()
                                
                                st.session_state.data = clean_df
                                st.session_state.last_updated = update_time
                                st.success(f"成功！匯入 {len(clean_df)} 筆資料。")
                                time.sleep(1)
                                st.rerun()
                            else:
                                st.error(error)

    # --- 主畫面 ---
    st.header("醫療產品資料庫")

    if st.session_state.data is not None:
        if st.session_state.has_searched:
            df = st.session_state.data
            filtered_df = df.copy()

            # 0. 權限預先過濾
            if st.session_state.is_manager_mode:
                # 噥噥模式：(依您需求，若打勾要隱藏南區，只看專用)
                allowed = MANAGER_HOSPITALS 
            else:
                # 一般模式：只顯示南區
                allowed = PUBLIC_HOSPITALS
                
            # 使用 filter_hospitals 進行模糊比對過濾
            allowed_list = filter_hospitals(df['醫院名稱'].unique(), allowed)
            filtered_df = filtered_df[filtered_df['醫院名稱'].isin(allowed_list)]

            # 1. 醫院篩選
            if st.session_state.qry_hosp:
                filtered_df = filtered_df[filtered_df['醫院名稱'].isin(st.session_state.qry_hosp)]
            
            # 2. 院內碼篩選
            if st.session_state.qry_code:
                k = st.session_state.qry_code.strip()
                m1 = filtered_df['院內碼'].str.contains(k, case=False, na=False)
                m2 = filtered_df['原始備註'].str.contains(k, case=False, na=False)
                filtered_df = filtered_df[m1 | m2]
            
            # 3. 關鍵字篩選
            if st.session_state.qry_key:
                kws = st.session_state.qry_key.split()
                for k in kws:
                    k_clean = re.sub(r'[^a-zA-Z0-9]', '', k)
                    m_search = filtered_df['搜尋用字串'].str.contains(k, case=False, na=False)
                    if k_clean:
                        m_search = m_search | filtered_df['搜尋用字串'].str.contains(k_clean, case=False, na=False)
                    m_note = filtered_df['原始備註'].str.contains(k, case=False, na=False)
                    m_hosp = filtered_df['醫院名稱'].str.contains(k, case=False, na=False)
                    filtered_df = filtered_df[m_search | m_note | m_hosp]

            st.caption(f"搜尋結果：{len(filtered_df)} 筆")
            
            if not filtered_df.empty:
                display_cols = ['醫院名稱', '產品名稱', '型號', '院內碼']
                st.dataframe(
                    filtered_df[display_cols].style.map(
                        lambda _: 'background-color: #f8f8ff; color: black; font-weight: bold;', 
                        subset=['醫院名稱']
                    ),
                    use_container_width=True, 
                    hide_index=True, 
                    height=700
                )
            else:
                st.warning("❌ 找不到資料")
        else:
            st.info("👈 請在左側輸入條件，並點擊「查詢」按鈕。")
    else:
        st.warning("⚠️ 請先在左側後台區上傳資料。")

if __name__ == "__main__":
    main()
