; The Windows installer: CO-Costume-Editor-<version>-Setup.exe. Built by "python make_release.py --installer"
; (and by .github/workflows/release.yml on a version tag), which passes:
;   /DAppVersion=0.5.1          from viewer/js/version.js
;   /DSourceDir=<folder>        the staged release: the editor's files plus CO Costume Editor.exe and _internal\
;
; It installs into Program Files (asking for admin rights), or, if the player picks "only for me", into
; %LOCALAPPDATA%\Programs without them. Either way it writes installed.ini beside the program, which tells the
; editor (paths.py) to keep what it makes (the data built from the game, settings.json, the Claude Code folder)
; in %LOCALAPPDATA%\CO Costume Editor, since Program Files can't be written to. Installing a newer version
; over an older one leaves that data alone; build.py rebuilds it only if the build format changed.
; When the editor is installed already, Setup says which version and offers to update it (or asks before
; reinstalling the same one or replacing a newer one), then goes into the same folder with the same choices.

#define AppName "CO Costume Editor"
#define AppExe "CO Costume Editor.exe"
; also names the uninstall entry Setup reads the installed version from
#define AppGuid "31bd8f76-ba20-499d-a18a-e665ad382230"
#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z (make_release.py --installer does)
#endif
#ifndef SourceDir
  #error Pass /DSourceDir=<staged release folder> (make_release.py --installer does)
#endif

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=sadders1
AppPublisherURL=https://github.com/codexheroes/co-character-creator
AppSupportURL=https://github.com/codexheroes/co-character-creator/issues
AppUpdatesURL=https://github.com/codexheroes/co-character-creator/releases
VersionInfoVersion={#AppVersion}
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
LicenseFile={#SourceDir}\LICENSE
SetupIconFile={#SourceDir}\app.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
OutputBaseFilename=CO-Costume-Editor-{#AppVersion}-Setup
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; code from an older version that this one may no longer have (the editor's data is elsewhere)
Type: filesandordirs; Name: "{app}\_internal"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\viewer\js"
Type: filesandordirs; Name: "{app}\__pycache__"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[INI]
; the marker paths.py looks for: keep the editor's data in the user's AppData, not beside the program
Filename: "{app}\installed.ini"; Section: "editor"; Key: "data"; String: "%LOCALAPPDATA%\{#AppName}"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; as the player, not as the administrator Setup ran as
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
Type: files; Name: "{app}\installed.ini"
Type: filesandordirs; Name: "{app}\__pycache__"
Type: filesandordirs; Name: "{app}\tools\__pycache__"

[Code]
// An installed editor: its version from its uninstall entry (HKLM for all users, HKCU for "only for me"),
// '' when there is none.
var
  Installed: String;

function InstalledVersion(): String;
var
  Key: String;
begin
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{' + '{#AppGuid}' + '}_is1';
  if not RegQueryStringValue(HKLM64, Key, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKCU, Key, 'DisplayVersion', Result) then
      Result := '';
end;

// Compares two versions (0.6.4 against 0.6.10): below 0 when A is older, 0 when they're the same
function CompareVersions(A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  while (Result = 0) and ((A <> '') or (B <> '')) do begin
    I := Pos('.', A); if I = 0 then I := Length(A) + 1;
    X := StrToIntDef(Copy(A, 1, I - 1), 0); Delete(A, 1, I);
    I := Pos('.', B); if I = 0 then I := Length(B) + 1;
    Y := StrToIntDef(Copy(B, 1, I - 1), 0); Delete(B, 1, I);
    Result := X - Y;
  end;
end;

// Before the wizard: offer to update an installed editor, and ask before reinstalling the same version or
// putting an older one over a newer one. Silent installs just go ahead.
function InitializeSetup(): Boolean;
var
  Cmp: Integer;
begin
  Result := True;
  Installed := InstalledVersion();
  if (Installed = '') or WizardSilent() then
    Exit;
  Cmp := CompareVersions('{#AppVersion}', Installed);
  if Cmp > 0 then
    Result := MsgBox('{#AppName} ' + Installed + ' is installed.' + #13#10 + #13#10 +
                     'Update it to version {#AppVersion}? Your settings and the editor''s data are kept, ' +
                     'so it starts straight away.', mbConfirmation, MB_YESNO) = IDYES
  else if Cmp = 0 then
    Result := MsgBox('{#AppName} {#AppVersion} is already installed.' + #13#10 + #13#10 +
                     'Install it again?', mbConfirmation, MB_YESNO) = IDYES
  else
    Result := MsgBox('A newer {#AppName} (' + Installed + ') is installed.' + #13#10 + #13#10 +
                     'Replace it with the older version {#AppVersion}?', mbError, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;

// An update skips the licence page: it was shown when the editor was first installed
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = wpLicense) and (Installed <> '');
end;

// The uninstaller removes what it installed. What the editor made itself is in the player's
// %LOCALAPPDATA%\CO Costume Editor (the data built from the game, about 175 MB, settings.json, the logs and
// my_costumes\ from Claude Code); that goes too only if the player says so: keeping it makes a reinstall
// start without the rebuild. Costumes saved with Save are in the game's folder and never touched.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  Data := ExpandConstant('{localappdata}\{#AppName}');
  if (CurUninstallStep = usPostUninstall) and DirExists(Data) and not UninstallSilent then
    if MsgBox('Also delete the CO Costume Editor''s own working data and settings?' + #13#10 + #13#10 +
              'This is the piece catalog the editor made when it first started (about 175 MB, in ' + Data + '). ' +
              'Choose No to keep it, so a reinstall starts straight away.' + #13#10 + #13#10 +
              'Champions Online itself and the costumes you saved are never changed or deleted, whichever you choose.',
              mbConfirmation, MB_YESNO) = IDYES then
      DelTree(Data, True, True, True);
end;
