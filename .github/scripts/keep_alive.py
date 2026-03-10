from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.common.by import By
import time
import sys

# 放 Streamlit 網址
URL = "https://southcode.streamlit.app/"

def keep_alive():
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    
    # 隱藏一些沒必要的 log
    options.add_argument("--log-level=3") 

    driver = None
    try:
        print(f"🌍 正在嘗試連線到 {URL} ...")
        
        # 自動下載並啟動 Chrome Driver
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        
        # 開啟網站
        driver.get(URL)
        
        # 等待網頁載入（Streamlit 初始化 WebSocket 需要時間）
        print("⏳ 等待網頁與 WebSocket 載入 (15 秒)...")
        time.sleep(15)
        
        # 如果 Streamlit 進入休眠，可能會出現喚醒按鈕，這裡嘗試點擊它
        try:
            # 尋找 "Yes, get this app back up!" 按鈕
            buttons = driver.find_elements(By.XPATH, "//button[contains(., 'Yes, get this app back up')]")
            if buttons:
                print("💤 發現 App 正在休眠，準備點擊喚醒按鈕...")
                buttons[0].click()
                print("✅ 已經點擊喚醒按鈕！")
                time.sleep(10) # 點擊後再等一下讓他啟動
        except Exception as btn_e:
            pass # 沒找到按鈕就代表原本是醒著的，不需要處理

        print("✅ 成功存取網頁，已送出心跳！")
        
    except Exception as e:
        print(f"⚠️ 發生錯誤: {e}")
        sys.exit(1)
    finally:
        if driver:
            driver.quit()

if __name__ == "__main__":
    keep_alive()
