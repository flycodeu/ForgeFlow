# -*- coding: utf-8 -*-
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "build.nsh"
Name "ForgeFlow"
OutFile "${OUTPUT}"
!ifdef TEST_DEFAULT
InstallDir "${TEST_DEFAULT}"
!else
InstallDir "$LOCALAPPDATA\Programs\ForgeFlow"
!endif
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
BrandingText "ForgeFlow"
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 ForgeFlow"
!define MUI_WELCOMEPAGE_TEXT "选择程序安装目录。项目数据的位置将在首次启动时设置。$\r$\n$\r$\n若检测到旧版，将自动读取历史安装位置进行无缝更新，并完整保留所有项目数据与配置。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\ForgeFlow.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\Uninstall.exe"
    StrCpy $INSTDIR $0
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "ForgeFlow 需要 64 位 Windows。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=guard.ps1 "${GUARD}"
FunctionEnd

Function CheckDirectory
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\guard.ps1" -Mode Install -Target "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "无法安装到此位置。请选择空的本地文件夹或已有 ForgeFlow 安装目录。$\r$\n$1" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
FunctionEnd

Section "ForgeFlow"
  Call CheckDirectory
  SetOverwrite on
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  File /oname=forgeflow-install-manifest.json "${MANIFEST}"
  FileOpen $0 "$INSTDIR\forgeflow-install-location.txt" w
  FileWriteWord $0 65279
  FileWriteUTF16LE $0 "$INSTDIR"
  FileClose $0
  !include "payload.nsh"
  CreateDirectory "$SMPROGRAMS\${APPKEY}"
  CreateShortcut "$SMPROGRAMS\${APPKEY}\ForgeFlow.lnk" "$INSTDIR\ForgeFlow.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "DisplayName" "ForgeFlow"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "NoRepair" 1
SectionEnd

Function un.onInit
  SetShellVarContext current
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=guard.ps1 "${GUARD}"
FunctionEnd

Section "Uninstall"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\guard.ps1" -Mode Uninstall -Target "$INSTDIR" -ManifestHash "${MANIFEST_HASH}"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    MessageBox MB_ICONSTOP "卸载未完成。请先退出 ForgeFlow；安装目录和清单必须保持原位。$\r$\n$1" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"
    Delete "$SMPROGRAMS\${APPKEY}\ForgeFlow.lnk"
    RMDir "$SMPROGRAMS\${APPKEY}"
  ${EndIf}
  Delete "$INSTDIR\forgeflow-install-manifest.json"
  Delete "$INSTDIR\forgeflow-install-location.txt"
  Delete "$INSTDIR\Uninstall.exe"
  SetOutPath "$TEMP"
  RMDir "$INSTDIR"
SectionEnd
