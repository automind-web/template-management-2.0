"use client";

import { Download, Smartphone } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { canInstall, isStandalone, onInstallChange, promptInstall } from "@/lib/pwa";

export function InstallApp() {
  const [installed, setInstalled] = React.useState(false);
  const [ios, setIos] = React.useState(false);
  const [native, setNative] = React.useState(false);
  const [help, setHelp] = React.useState(false);
  React.useEffect(() => {
    const sync = () => { setInstalled(isStandalone()); setNative(canInstall()); };
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    sync();
    return onInstallChange(sync);
  }, []);
  const install = async () => {
    if (!native || !(await promptInstall())) setHelp(true);
  };
  return (
    <>
      <Section title="Приложение на Вашем устройстве" actions={<Smartphone className="size-5 text-muted-foreground" />}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-sm text-muted-foreground">{installed ? "Приложение установлено. Разрешите уведомления ниже, чтобы получать их на этом устройстве." : "Открывайте задачи с экрана телефона или рабочего стола. Уведомления можно получать и при закрытом приложении."}</p>
          {!installed ? <Button variant="outline" onClick={() => void install()}><Download />Установить как приложение</Button> : <span className="text-sm font-semibold text-success">Установлено</span>}
        </div>
      </Section>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title={ios ? "Установка на iPhone и iPad" : "Установка приложения"}>
          <ol className="list-decimal space-y-3 pl-5 text-[15px]">
            {ios ? <>
              <li>Откройте этот сайт в Safari.</li>
              <li>Нажмите «Поделиться» и выберите «На экран Домой».</li>
              <li>Нажмите «Добавить» и откройте приложение с нового значка.</li>
              <li>В разделе «Уведомления» включите уведомления устройства. Нужна iOS или iPadOS 16.4 и новее.</li>
            </> : <>
              <li>В Chrome или Edge откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».</li>
              <li>В Safari на Mac выберите «Файл» → «Добавить в Dock».</li>
              <li>Откройте приложение и разрешите уведомления в этом разделе.</li>
            </>}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
