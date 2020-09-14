import path from "path";

import { Application } from "spectron";
import electron from "electron";

import "dotenv/config";
import { expect } from "chai";

const prefix = process.platform === "win32" ? "/C:" : "";

// @ts-ignore
process.env.ELECTRON_IS_DEV = 0;

const { PASSWORD } = process.env;

if (PASSWORD === undefined) throw Error("failed to load password from .env");

describe("test", function () {
  this.timeout(10000);

  let app: Application;
  let history = [`${prefix}/login`];

  before(function () {
    app = new Application({
      path: (electron as unknown) as string,
      args: [path.join(__dirname, "..", "dist")],
    });
    return app.start();
  });

  afterEach(async function () {
    const pathname = await app.webContents.executeJavaScript(
      "location.pathname"
    );
    if (typeof pathname !== "string")
      throw Error("현재 경로를 가져오지 못했습니다");
    if (pathname.includes("/error"))
      throw Error("오류 페이지로 이동이 되었습니다");

    if (history[history.length - 1] === pathname)
      throw Error(
        `"${
          prefix === "/C:" ? pathname.slice(3) : pathname
        }"에서 다음 페이지로 이동에 실패했습니다.`
      );

    history.push(pathname);
  });

  it("로그인 하기", async function () {
    const inputPassword = await app.client.$('input[type="password"]');
    await inputPassword.setValue(PASSWORD);

    const submitButton = await app.client.$('button[type="submit"]');
    await submitButton.click();
  });

  it("마이닝 끄기", async function () {
    const miningOffButton = await app.client.$("#mining-off");
    await miningOffButton.click();
  });

  it("로비 뷰에서 실행 버튼 기다리기", async function () {
    const submitButton = await app.client.$("#start-game");
    const text = await submitButton.getText();
    expect(text).to.equal("NOW RUNNING...");
  });

  after(function () {
    if (app?.isRunning()) {
      return app.mainProcess.exit(0);
    }
  });
});
