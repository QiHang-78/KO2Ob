local MultiInputDialog = require("ui/widget/multiinputdialog")
local InfoMessage = require("ui/widget/infomessage")
local Notification = require("ui/widget/notification")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local NetworkMgr = require("ui/network/manager")
local http = require("socket.http")
local ltn12 = require("ltn12")
local rapidjson = require("rapidjson")
local socket = require("socket")
local socketutil = require("socketutil")
local _ = require("gettext")
local T = require("ffi/util").template

local DEFAULT_SETTINGS = {
    server_url = "http://127.0.0.1:8787",
    api_key = "",
    device_id = nil,
    auto_upload = false,
    auto_upload_on_close = true,
    auto_upload_idle_seconds = 8,
}

local KOReaderObsidianSync = WidgetContainer:extend{
    name = "koreaderobsidiansync",
    settings = nil,
    upload_scheduled = false,
    last_uploaded_signature = nil,
    pending_change_count = 0,
    upload_task = nil,
}

local function trim(value)
    if not value then
        return ""
    end
    return value:match("^%s*(.-)%s*$") or ""
end

local function toboolean(value)
    return value and true or false
end

local function iso_from_koreader_datetime(value)
    if not value or value == "" then
        return nil
    end
    local year, month, day, hour, minute, second =
        value:match("(%d+)%-(%d+)%-(%d+) (%d+):(%d+):(%d+)")
    if not year then
        return nil
    end
    return string.format("%04d-%02d-%02dT%02d:%02d:%02dZ",
        tonumber(year), tonumber(month), tonumber(day),
        tonumber(hour), tonumber(minute), tonumber(second))
end

local function signature_for_entries(title, author, entries)
    local parts = { title or "", "\n", author or "", "\n", tostring(#entries), "\n" }
    for _, entry in ipairs(entries) do
        parts[#parts + 1] = entry.text or ""
        parts[#parts + 1] = "\n"
        parts[#parts + 1] = entry.note or ""
        parts[#parts + 1] = "\n"
        parts[#parts + 1] = entry.chapter or ""
        parts[#parts + 1] = "\n"
        parts[#parts + 1] = tostring(entry.page or "")
        parts[#parts + 1] = "\n"
        parts[#parts + 1] = tostring(entry.updatedAt or entry.createdAt or "")
        parts[#parts + 1] = "\n--\n"
    end
    return table.concat(parts)
end

function KOReaderObsidianSync:init()
    self.settings = G_reader_settings:readSetting("koreader_obsidian_sync") or {}
    for key, value in pairs(DEFAULT_SETTINGS) do
        if self.settings[key] == nil then
            self.settings[key] = value
        end
    end
    if not self.settings.device_id or self.settings.device_id == "" then
        self.settings.device_id = G_reader_settings:readSetting("device_id") or "koreader-device"
    end

    self.upload_scheduled = false
    self.pending_change_count = 0
    self.last_uploaded_signature = nil
    self.upload_task = function()
        self.upload_scheduled = false
        self:uploadCurrentBook(false, true)
    end

    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end
    self:registerEvents()
end

function KOReaderObsidianSync:saveSettings()
    G_reader_settings:saveSetting("koreader_obsidian_sync", self.settings)
end

function KOReaderObsidianSync:registerEvents()
    if self.settings.auto_upload then
        self.onAnnotationsModified = self._onAnnotationsModified
        self.onCloseDocument = self._onCloseDocument
        self.onResume = self._onResume
        self.onSuspend = self._onSuspend
    elseif self.settings.auto_upload_on_close then
        self.onAnnotationsModified = nil
        self.onCloseDocument = self._onCloseDocument
        self.onResume = nil
        self.onSuspend = nil
    else
        self.onAnnotationsModified = nil
        self.onCloseDocument = nil
        self.onResume = nil
        self.onSuspend = nil
    end
end

function KOReaderObsidianSync:addToMainMenu(menu_items)
    menu_items.koreader_obsidian_sync = {
        text = _("Obsidian Sync"),
        sub_item_table = {
            {
                text = _("Upload current book highlights"),
                enabled_func = function()
                    return self.document ~= nil
                end,
                callback = function()
                    self:uploadCurrentBook(true, false)
                end,
            },
            {
                text = _("Auto upload while reading"),
                checked_func = function()
                    return toboolean(self.settings.auto_upload)
                end,
                callback = function()
                    self.settings.auto_upload = not self.settings.auto_upload
                    self:saveSettings()
                    self:registerEvents()
                    Notification:notify(self.settings.auto_upload
                        and _("Auto upload while reading: on")
                        or _("Auto upload while reading: off"))
                end,
            },
            {
                text = _("Upload when closing book"),
                checked_func = function()
                    return toboolean(self.settings.auto_upload_on_close)
                end,
                callback = function()
                    self.settings.auto_upload_on_close = not self.settings.auto_upload_on_close
                    self:saveSettings()
                    self:registerEvents()
                    Notification:notify(self.settings.auto_upload_on_close
                        and _("Upload on close: on")
                        or _("Upload on close: off"))
                end,
            },
            {
                text_func = function()
                    return T(_("Idle delay before auto upload: %1 s"),
                        tostring(self.settings.auto_upload_idle_seconds or DEFAULT_SETTINGS.auto_upload_idle_seconds))
                end,
                enabled_func = function()
                    return toboolean(self.settings.auto_upload)
                end,
                keep_menu_open = true,
                callback = function()
                    self:showIdleDelayDialog()
                end,
            },
            {
                text = _("Configure sync server"),
                callback = function()
                    self:showSettingsDialog()
                end,
            },
            {
                text = _("Show current configuration"),
                callback = function()
                    self:showCurrentConfiguration()
                end,
            },
        },
    }
end

function KOReaderObsidianSync:showCurrentConfiguration()
    UIManager:show(InfoMessage:new{
        text = T(_("Server: %1\nDevice: %2\nAuto upload: %3\nUpload on close: %4\nAPI key set: %5"),
            self.settings.server_url or "",
            self.settings.device_id or "",
            self.settings.auto_upload and _("yes") or _("no"),
            self.settings.auto_upload_on_close and _("yes") or _("no"),
            self.settings.api_key ~= "" and _("yes") or _("no")),
    })
end

function KOReaderObsidianSync:showIdleDelayDialog()
    local dialog
    dialog = MultiInputDialog:new{
        title = _("Auto upload delay"),
        fields = {
            {
                description = _("Seconds after last highlight change"),
                hint = tostring(DEFAULT_SETTINGS.auto_upload_idle_seconds),
                text = tostring(self.settings.auto_upload_idle_seconds or DEFAULT_SETTINGS.auto_upload_idle_seconds),
                input_type = "number",
            },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    callback = function()
                        local fields = dialog:getFields()
                        local delay = tonumber(fields[1])
                        if not delay or delay < 3 then
                            delay = DEFAULT_SETTINGS.auto_upload_idle_seconds
                        end
                        self.settings.auto_upload_idle_seconds = math.floor(delay)
                        self:saveSettings()
                        UIManager:close(dialog)
                        Notification:notify(T(_("Auto upload delay set to %1 seconds."),
                            tostring(self.settings.auto_upload_idle_seconds)))
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function KOReaderObsidianSync:showSettingsDialog()
    local dialog
    dialog = MultiInputDialog:new{
        title = _("KOReader Obsidian Sync"),
        fields = {
            {
                description = _("Server URL"),
                hint = "http://127.0.0.1:8787",
                text = self.settings.server_url or "",
                input_type = "string",
            },
            {
                description = _("API key"),
                hint = _("Optional"),
                text = self.settings.api_key or "",
                input_type = "string",
            },
            {
                description = _("Device name"),
                hint = _("koreader-device"),
                text = self.settings.device_id or "",
                input_type = "string",
            },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    callback = function()
                        UIManager:close(dialog)
                    end,
                },
                {
                    text = _("Save"),
                    callback = function()
                        local fields = dialog:getFields()
                        self.settings.server_url = trim(fields[1])
                        self.settings.api_key = trim(fields[2])
                        self.settings.device_id = trim(fields[3])
                        if self.settings.server_url == "" then
                            UIManager:show(InfoMessage:new{
                                text = _("Server URL is required."),
                            })
                            return
                        end
                        if self.settings.device_id == "" then
                            self.settings.device_id = "koreader-device"
                        end
                        self:saveSettings()
                        UIManager:close(dialog)
                        Notification:notify(_("Obsidian Sync settings saved."))
                    end,
                },
            },
        },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function KOReaderObsidianSync:buildDocumentPayload()
    if not self.ui or not self.ui.annotation or not self.ui.annotation:hasAnnotations() then
        return nil, _("No highlights found in current book.")
    end

    self.ui.annotation:updatePageNumbers(true)

    local props = self.ui.doc_props or {}
    local title = props.title or self.document.file:gsub(".*/", "")
    local author = props.authors or ""
    local entries = {}

    for _, item in ipairs(self.ui.annotation.annotations) do
        if item.text and item.text ~= "" then
            table.insert(entries, {
                sort = "highlight",
                text = item.text,
                note = item.note or "",
                chapter = item.chapter or "",
                page = item.pageref or item.pageno,
                color = item.color,
                drawer = item.drawer,
                createdAt = iso_from_koreader_datetime(item.datetime),
                updatedAt = iso_from_koreader_datetime(item.datetime_updated or item.datetime),
                sourcePage = item.page,
            })
        end
    end

    if #entries == 0 then
        return nil, _("No exportable text highlights found in current book.")
    end

    local pages = nil
    local info = self.ui.bookinfo and self.ui.bookinfo.getBookInfo and self.ui.bookinfo:getBookInfo(self.document.file)
    if info and info.pages then
        pages = info.pages
    end

    local signature = signature_for_entries(title, author, entries)

    return {
        source = "koreader",
        deviceId = self.settings.device_id or "koreader-device",
        document = {
            title = title,
            author = author,
            sourcePath = self.document.file,
            numberOfPages = pages,
            exportedAt = os.date("!%Y-%m-%dT%H:%M:%SZ"),
            entries = entries,
        },
        _signature = signature,
    }
end

function KOReaderObsidianSync:makeJsonRequest(endpoint, method, body, headers)
    local sink = {}
    local body_json, err = rapidjson.encode(body)
    if not body_json then
        return nil, "cannot encode body: " .. (err or "")
    end

    socketutil:set_timeout(socketutil.LARGE_BLOCK_TIMEOUT, socketutil.LARGE_TOTAL_TIMEOUT)
    local request = {
        url = endpoint,
        method = method,
        sink = ltn12.sink.table(sink),
        source = ltn12.source.string(body_json),
        headers = {
            ["Content-Length"] = #body_json,
            ["Content-Type"] = "application/json",
        },
    }

    for key, value in pairs(headers or {}) do
        request.headers[key] = value
    end

    local code, _, status = socket.skip(1, http.request(request))
    socketutil:reset_timeout()

    if code ~= 200 then
        return nil, status or tostring(code)
    end

    local response_body = table.concat(sink)
    local response, decode_err = rapidjson.decode(response_body)
    if not response then
        return nil, "cannot decode response: " .. (decode_err or "")
    end
    return response
end

function KOReaderObsidianSync:clearScheduledUpload()
    if self.upload_task then
        UIManager:unschedule(self.upload_task)
    end
    self.upload_scheduled = false
end

function KOReaderObsidianSync:scheduleAutoUpload()
    if not self.settings.auto_upload then
        return
    end
    self:clearScheduledUpload()
    local delay = tonumber(self.settings.auto_upload_idle_seconds) or DEFAULT_SETTINGS.auto_upload_idle_seconds
    UIManager:scheduleIn(delay, self.upload_task)
    self.upload_scheduled = true
end

function KOReaderObsidianSync:_onAnnotationsModified(_items)
    self.pending_change_count = (self.pending_change_count or 0) + 1
    self:scheduleAutoUpload()
end

function KOReaderObsidianSync:_onSuspend()
    self:clearScheduledUpload()
end

function KOReaderObsidianSync:_onResume()
    if self.settings.auto_upload and (self.pending_change_count or 0) > 0 then
        self:scheduleAutoUpload()
    end
end

function KOReaderObsidianSync:_onCloseDocument()
    self:clearScheduledUpload()
    if not self.settings.auto_upload_on_close then
        return
    end
    NetworkMgr:goOnlineToRun(function()
        self:uploadCurrentBook(false, true)
    end)
end

function KOReaderObsidianSync:uploadCurrentBook(show_feedback, suppress_if_unchanged)
    if NetworkMgr:willRerunWhenOnline(function() self:uploadCurrentBook(show_feedback, suppress_if_unchanged) end) then
        return
    end

    local payload, err = self:buildDocumentPayload()
    if not payload then
        if show_feedback then
            UIManager:show(InfoMessage:new{
                text = err,
            })
        end
        return false
    end

    if suppress_if_unchanged and payload._signature == self.last_uploaded_signature then
        return true
    end

    local signature = payload._signature
    payload._signature = nil

    local endpoint = (self.settings.server_url or ""):gsub("/+$", "") .. "/api/v1/documents"
    local headers = {}
    if self.settings.api_key and self.settings.api_key ~= "" then
        headers["x-api-key"] = self.settings.api_key
    end

    if show_feedback then
        UIManager:show(InfoMessage:new{
            text = _("Uploading highlights…"),
            timeout = 1,
        })
    end

    local response, request_err = self:makeJsonRequest(endpoint, "POST", payload, headers)
    if not response or not response.ok then
        if show_feedback then
            UIManager:show(InfoMessage:new{
                text = T(_("Upload failed: %1"), request_err or _("Unknown error")),
            })
        end
        return false
    end

    self.last_uploaded_signature = signature
    self.pending_change_count = 0

    if show_feedback then
        local document = response.document or {}
        Notification:notify(T(_("Uploaded %1 highlights for %2."),
            tostring(#payload.document.entries),
            document.title or payload.document.title))
    end

    return true
end

function KOReaderObsidianSync:onCloseWidget()
    self:clearScheduledUpload()
    self.upload_task = nil
end

return KOReaderObsidianSync
