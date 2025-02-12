import styles from "./auth.module.scss";
import { IconButton } from "./button";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Path, SAAS_CHAT_URL } from "../constant";
import { useAccessStore } from "../store";
import Locale from "../locales";
import Delete from "../icons/close.svg";
import Arrow from "../icons/arrow.svg";
import Logo from "../icons/logo.svg";
import { useMobileScreen } from "@/app/utils";
import BotIcon from "../icons/bot.svg";
import { getClientConfig } from "../config/client";
import { PasswordInput } from "./ui-lib";
import LeftIcon from "@/app/icons/left.svg";
import { safeLocalStorage } from "@/app/utils";
import {
  trackSettingsPageGuideToCPaymentClick,
  trackAuthorizationPageButtonToCPaymentClick,
} from "../utils/auth-settings-events";
import clsx from "clsx";

const storage = safeLocalStorage();

const FirstLogin = "前往 SiliconFlow 注册登录登录";
const LoginAgain = "使用 SiliconFlow 账号重新登录";
type AuthBtnText = typeof FirstLogin | typeof LoginAgain;
function AuthBtn(props: { disabled?: boolean; text: AuthBtnText }) {
  return (
    <IconButton
      type={"primary"}
      text={props.text}
      onClick={() => {
        window.location.href = `${
          process.env.NEXT_PUBLIC_SF_NEXT_CHAT_SF_ACCOUNT_ENDPOINT ||
          "https://account.siliconflow.cn"
        }/oauth?client_id=${process.env.NEXT_PUBLIC_SF_NEXT_CHAT_CLIENT_ID}`;
      }}
      disabled={props.disabled}
    />
  );
}

const mainColor = "rgb(124, 58, 237)";

export function StayPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();

  useEffect(() => {
    if (getClientConfig()?.isApp) {
      navigate(Path.Settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles["auth-page"]}>
      <div className={styles["auth-header"]}></div>
      <div className={styles["auth-title"]}>{"已退出 SiliconChat"}</div>
      <Notice />
      <div className={styles["auth-actions"]}>
        <AuthBtn text={LoginAgain} />
      </div>
    </div>
  );
}

function Notice() {
  return (
    <div className={styles["auth-tips"]}>
      如需体验「Pro」或「深度思考」请完成{" "}
      <b style={{ color: mainColor }}>实名认证</b>
      {" 并确保 "}
      <b style={{ color: mainColor }}>充值余额</b>
      {" 充足"}
    </div>
  );
}

export function AuthPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const goHome = () => navigate(Path.Home);
  const goChat = () => navigate(Path.Chat);
  const goSaas = () => {
    trackAuthorizationPageButtonToCPaymentClick();
    window.location.href = SAAS_CHAT_URL;
  };

  const resetAccessCode = () => {
    accessStore.update((access) => {
      access.openaiApiKey = "";
      access.accessCode = "";
    });
  }; // Reset access code to empty string
  useEffect(() => {
    if (getClientConfig()?.isApp) {
      navigate(Path.Settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isCountdownCanceledOrFinished, setIsCountdownCanceledOrFinished] =
    useState(false);
  const COUNT_DOWN_SECONDS = 5;
  const [countDownSeconds, setCountDownSeconds] = useState(COUNT_DOWN_SECONDS);
  const timer = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    timer.current = setTimeout(() => {
      setIsCountdownCanceledOrFinished(true);
      window.location.href = `${
        process.env.NEXT_PUBLIC_SF_NEXT_CHAT_SF_ACCOUNT_ENDPOINT ||
        "https://account.siliconflow.cn"
      }/oauth?client_id=${process.env.NEXT_PUBLIC_SF_NEXT_CHAT_CLIENT_ID}`;
    }, 5000);

    for (let i = 1; i <= COUNT_DOWN_SECONDS; i++) {
      setTimeout(() => {
        setCountDownSeconds(5 - i);
      }, i * 1000);
    }
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  return (
    <div className={styles["auth-page"]}>
      <div className={styles["auth-header"]}></div>
      <div className={styles["auth-title"]}>{"欢迎使用 SiliconChat"}</div>
      <div
        className={styles["auth-tips"]}
        hidden={isCountdownCanceledOrFinished}
      >
        即将前往 SiliconFlow 统一登录 ...... {countDownSeconds}{" "}
        <b
          style={{ color: mainColor }}
          onClick={() => {
            if (timer.current) {
              clearTimeout(timer.current);
            }
            setIsCountdownCanceledOrFinished(true);
          }}
        >
          取消
        </b>
      </div>
      <Notice />
      <div className={styles["auth-actions"]}>
        <AuthBtn text={FirstLogin} />
      </div>
    </div>
  );
  return (
    <div className={styles["auth-page"]}>
      <TopBanner></TopBanner>
      <div className={styles["auth-header"]}>
        <IconButton
          icon={<LeftIcon />}
          text={Locale.Auth.Return}
          onClick={() => navigate(Path.Home)}
        ></IconButton>
      </div>
      <div className={clsx("no-dark", styles["auth-logo"])}>
        <BotIcon />
      </div>

      <div className={styles["auth-title"]}>{Locale.Auth.Title}</div>
      <div className={styles["auth-tips"]}>{Locale.Auth.Tips}</div>
      <PasswordInput
        style={{ marginTop: "3vh", marginBottom: "3vh" }}
        aria={Locale.Settings.ShowPassword}
        aria-label={Locale.Auth.Input}
        value={accessStore.accessCode}
        type="text"
        placeholder={Locale.Auth.Input}
        onChange={(e) => {
          accessStore.update(
            (access) => (access.accessCode = e.currentTarget.value),
          );
        }}
      />

      {!accessStore.hideUserApiKey ? (
        <>
          <div className={styles["auth-tips"]}>{Locale.Auth.SubTips}</div>
          <PasswordInput
            style={{ marginTop: "3vh", marginBottom: "3vh" }}
            aria={Locale.Settings.ShowPassword}
            aria-label={Locale.Settings.Access.OpenAI.ApiKey.Placeholder}
            value={accessStore.openaiApiKey}
            type="text"
            placeholder={Locale.Settings.Access.OpenAI.ApiKey.Placeholder}
            onChange={(e) => {
              accessStore.update(
                (access) => (access.openaiApiKey = e.currentTarget.value),
              );
            }}
          />
          <PasswordInput
            style={{ marginTop: "3vh", marginBottom: "3vh" }}
            aria={Locale.Settings.ShowPassword}
            aria-label={Locale.Settings.Access.Google.ApiKey.Placeholder}
            value={accessStore.googleApiKey}
            type="text"
            placeholder={Locale.Settings.Access.Google.ApiKey.Placeholder}
            onChange={(e) => {
              accessStore.update(
                (access) => (access.googleApiKey = e.currentTarget.value),
              );
            }}
          />
        </>
      ) : null}

      <div className={styles["auth-actions"]}>
        <IconButton
          text={Locale.Auth.Confirm}
          type="primary"
          onClick={goChat}
        />
        <IconButton
          text={Locale.Auth.SaasTips}
          onClick={() => {
            goSaas();
          }}
        />
      </div>
    </div>
  );
}

function TopBanner() {
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const isMobile = useMobileScreen();
  useEffect(() => {
    storage.setItem("bannerDismissed", "true");
    // 检查 localStorage 中是否有标记
    const bannerDismissed = storage.getItem("bannerDismissed");
    // 如果标记不存在，存储默认值并显示横幅
    if (!bannerDismissed) {
      storage.setItem("bannerDismissed", "false");
      setIsVisible(true); // 显示横幅
    } else if (bannerDismissed === "true") {
      // 如果标记为 "true"，则隐藏横幅
      setIsVisible(false);
    }
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleClose = () => {
    setIsVisible(false);
    storage.setItem("bannerDismissed", "true");
  };

  if (!isVisible) {
    return null;
  }
  return (
    <div
      className={styles["top-banner"]}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className={clsx(styles["top-banner-inner"], "no-dark")}>
        <Logo className={styles["top-banner-logo"]}></Logo>
        <span>
          {Locale.Auth.TopTips}
          <a
            href={SAAS_CHAT_URL}
            rel="stylesheet"
            onClick={() => {
              trackSettingsPageGuideToCPaymentClick();
            }}
          >
            {Locale.Settings.Access.SaasStart.ChatNow}
            <Arrow style={{ marginLeft: "4px" }} />
          </a>
        </span>
      </div>
      {(isHovered || isMobile) && (
        <Delete className={styles["top-banner-close"]} onClick={handleClose} />
      )}
    </div>
  );
}
