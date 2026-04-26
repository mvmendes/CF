; Instalador offline: copia o conteúdo empacotado em staging\.agents para C:\CCB\CF\.agents
; Compilar (após build-staging.ps1): "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" CF-Agents-Offline.iss
; Ou: ISCC.exe /DMyAppVersion=1.2.3 CF-Agents-Offline.iss

#ifndef MyAppVersion
  #define MyAppVersion "dev"
#endif

#define MyAppName "CF Agents"
#define MyAppPublisher "CCB / CF"
#define StagingDir "staging"

[Setup]
AppId={{A7E2B9C1-4F0D-4D8A-9C3E-1B2A3C4D5E6F}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=C:\CCB\CF
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=CF-Agents-Setup-{#MyAppVersion}
OutputDir=..\..\dist\installer
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
Uninstallable=no
CreateAppDir=yes
; Sem atalhos — .agents e Node embutido (path do sistema ajustado em [Code])

[Files]
; Staging: build-offline-installer.ps1 (node-embedded.txt = versão; zip win-x64 em cache)
Source: "{#StagingDir}\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
; Origem = pasta ao lado deste .iss, gerada por build-offline-installer.ps1
Source: "{#StagingDir}\.agents\*"; DestDir: "{app}\.agents"; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
procedure PrependNodeToPath;
var
  NodePath, OldPath, NewPath, Needle, Hay: String;
begin
  NodePath := ExpandConstant('{app}\node');
  if (Length(NodePath) > 0) and (NodePath[Length(NodePath)] = '\') then
    SetLength(NodePath, Length(NodePath) - 1);
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', OldPath) then
    OldPath := '';
  Needle := ';' + LowerCase(NodePath) + ';';
  Hay := LowerCase( ';' + OldPath + ';');
  if Pos(Needle, Hay) > 0 then
    exit;
  if OldPath = '' then
    NewPath := NodePath
  else
    NewPath := NodePath + ';' + OldPath;
  RegWriteExpandStringValue(HKLM, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', NewPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    PrependNodeToPath;
end;
