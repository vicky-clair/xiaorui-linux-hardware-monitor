# Linux 双磁盘长期健康与防磨损优化指南（Debian 13：外接 USB 机械盘 + 系统盘 SSD）

> 适用环境：Debian 13（Linux 6.12+）宿主机，包含系统盘 M.2 SATA SSD（`/dev/sda`）与长期挂载的 USB 3.0 移动机械硬盘（`/dev/sdb`，例如 Emby 媒体库）。
> 本文完整记录 2026-11-20 至 2026-11-21 在实机完成并经 **10 小时跨夜复查验证** 的外接盘 **方案 A** 与系统盘 **SSD 延寿基础包（项 1–2）** 全部宿主机改动、验收命令、实测数据及一键回滚方式，方便日后查阅或重装系统时快速复用。

---

## 1. 优化背景与实机体检基线

优化前对宿主机外接盘（`HGST Travelstar 7K1000 / HTS721010A9E630`，2.5 寸 7200 转 1 TB，挂载于 `/media/usb` 供 `emby-server` 使用）的实测基线：

| 检查维度 | 优化前实测状态 | 风险与问题 |
| ---- | ---- | ---- |
| USB 桥接主控与协议 | `JMicron JMS578`（`152d:0578`），USB 3.0 `5000 Mbps`，驱动 **`uas`**，`dmesg` 零错误 | 链路本身稳定，无需降级 `uas`；但缺少 `udev` 规则锁定 `power/control="on"` |
| `/etc/fstab` 挂载方式 | 写死 `/dev/sdb1`，选项 `ntfs-3g uid=emby,gid=emby,umask=0022,nofail` | 重启或插拔其他 USB 设备时可能盘符漂移（如变为 `sdc1`）；默认 `relatime` 会因读盘触发访问时间写回；缺少 `big_writes` 与启动设备等待超时 |
| 顺序预读缓冲 | `read_ahead_kb = 128`（128 KiB） | 高码率大视频文件顺序读取吞吐偏保守 |
| **磁头归位 (`193 Load_Cycle_Count`)** | **242,362 次** / 通电 `14,100 h` ≈ **17.2 次/小时（平均每 3.5 分钟归位一次）** | 硬盘默认 **`APM = 128`**（最激进的非停转节能档），2.5 寸盘标称约 60 万次，已消耗约 40%，是主要机械磨损源 |
| **主轴启停 (`4 Start_Stop_Count`)** | **19,208 次**（冷启 `12 Power_Cycle_Count` 仅 939 次 ≈ 每 44 分钟启停一次） | JMS578 盒体自动休眠 + 后台不定期扫库/读取形成反复唤醒拉锯 |
| **工作温度 (`194 Temperature_Celsius`)** | 当前 **46 °C**（历史最高 **52 °C**，最低 15 °C） | 7200 转盘装在封闭盒内散热有限，长期建议 ≤ 50 °C |
| 盘片健康与链路校验 | `05` / `C5` / `C6` / `0A` / `BF` 全为 **0**；`199 UDMA_CRC_Error_Count = 72` | 盘片无坏道；`199` 为历史累计值，后续观察是否继续增长即可 |

---

## 2. 核心策略：为什么“关磁头归位、留自然休眠”？

磁头归位（APM）与磁盘休眠（Standby 停转）是两项独立机制，针对 7200 转封闭式 USB 移动盘采取**方案 A** 平衡磨损与温度：

1. **关闭激进磁头归位（`APM = 254`，强烈建议）**
   - `APM = 128` 会让硬盘空闲十几秒到几分钟就卸载磁头到坡道，几乎不省电却急剧消耗 `Load_Cycle_Count`。
   - 调整为 **`APM = 254`（maximum performance）** 可立即停止高频磁头归位，且几乎不增加盘体温度。
   - **实机验证**：经 `smartctl -s apm,254 /dev/sdb` 下发后，`smartctl -g apm /dev/sdb` 回读确认返回 `APM level is: 254 (maximum performance)`，证明 JMS578 可正常透传 APM 指令。
2. **保留自然休眠，同时减少无谓唤醒（不强制 24 小时常转）**
   - 7200 转盘在密闭 USB 盒中实测已达 46–52 °C；若非全天候持续读写，强行禁用休眠会导致盘体长期处于 ~50 °C 高温。
   - 正确做法是通过 `noatime` 挂载、12 小时超低功耗硬件监控（`lhm-agent` 使用 `smartctl -n standby`）、以及降低 Emby 定时扫库频率，让硬盘“使用时稳定运行、不用时安静休眠”。
3. **保持 `uas` 驱动不降级**
   - 只要 `dmesg` 无 USB 重置/超时且 `199 UDMA_CRC_Error_Count` 不继续上涨，保持 `uas` 可获得更高吞吐与更低 CPU 占用。

---

## 3. 宿主机实际改动清单（方案 A）

### 3.1 新增持久化 `udev` 规则

文件路径：`/etc/udev/rules.d/99-usb-hdd-optimize.rules`（权限 `0644`）

```udev
# 1. 锁定 JMicron JMS578 USB 3.0 SATA 桥接端口禁止 USB autosuspend 挂起
ACTION=="add|change", SUBSYSTEM=="usb", ATTR{idVendor}=="152d", ATTR{idProduct}=="0578", TEST=="power/control", ATTR{power/control}="on"

# 2. 按硬盘唯一 WWN 精准匹配 HGST 移动盘：提升顺序预读至 1 MiB，并关闭高频磁头归位（APM=254）
ACTION=="add|change", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", ENV{ID_WWN}=="0x5000cca8a8ccadbf", ATTR{queue/read_ahead_kb}="1024", RUN+="/usr/sbin/smartctl -s apm,254 /dev/%k"
```

> **更换硬盘复用提示**：可通过以下两条命令查询新硬盘的 `idVendor`/`idProduct` 与唯一 `ID_WWN`：
> ```bash
> lsusb
> udevadm info --query=property --name=/dev/sdX | grep -E '^(ID_WWN|ID_SERIAL|DEVTYPE)='
> ```

加载并立即触发规则生效：

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger --action=change /sys/block/sdb
sudo udevadm settle
```

### 3.2 优化 `/etc/fstab` 挂载配置

修改前已将原文件备份至 `/etc/fstab.bak-20261120`。变更差异如下：

```diff
-/dev/sdb1 /media/usb ntfs-3g uid=emby,gid=emby,umask=0022,nofail 0 0
+UUID=D8B2FD20B2FD0432 /media/usb ntfs-3g uid=emby,gid=emby,umask=0022,noatime,big_writes,nofail,x-systemd.device-timeout=15 0 0
```

参数说明：
- **`UUID=D8B2FD20B2FD0432`**：绑定分区唯一 UUID（可用 `lsblk -f` 查看），彻底避免多盘环境下 `/dev/sdb1` 漂移导致挂载失败。
- **`noatime`**：读取视频文件时不再回写文件访问时间戳，显著减少磁盘写操作与误唤醒。
- **`big_writes`**：允许 `ntfs-3g`（FUSE）合并大块写缓冲而非拆分为 4 KiB，提升写入吞吐并降低 CPU 占用。
- **`nofail,x-systemd.device-timeout=15`**：拔掉移动硬盘时开机最多等待 15 秒并正常进入系统，不会卡住引导。

重载 systemd 并安全重挂载（需先确认无进程占用 `/media/usb`）：

```bash
sudo systemctl daemon-reload
# 确认返回非 0（无打开文件）后再卸载重挂
sudo fuser -m /media/usb || (sudo umount /media/usb && sudo mount /media/usb)
```

---

## 4. 验收命令与实测通过结果

以后重装系统或插拔硬盘后，可执行以下只读命令一键核对优化是否全部生效：

```bash
# 1. 检查挂载参数（应包含 noatime、big_writes）与属主（emby:emby）
findmnt -o SOURCE,TARGET,FSTYPE,OPTIONS /media/usb
ps -ef | grep '[n]tfs-3g'
ls -ld /media/usb

# 2. 检查顺序预读（应为 1024）与 USB 电源控制（应为 on）
cat /sys/block/sdb/queue/read_ahead_kb
grep . /sys/bus/usb/devices/*/power/control 2>/dev/null

# 3. 检查 APM 磁头归位档位（应为 254）与关键 SMART 计数
sudo smartctl -g apm /dev/sdb
sudo smartctl -A /dev/sdb | awk '$1 ~ /^(4|5|9|193|194|197|198|199)$/'
```

2026-11-20 实机验收与 2026-11-21 **10 小时跨夜复查**对照：

| 检查项 | 优化前 | 优化后即时实测 | 10 小时跨夜复查（2026-11-21 07:33） |
| ---- | ---- | ---- | ---- |
| 挂载方式 | `/dev/sdb1`（`relatime`） | `UUID=D8B2FD20B2FD0432`（`noatime,big_writes,nofail`） | 持续稳定生效 |
| USB 自动挂起 | 未锁定 | `power/control = on`（`udev` 持久化锁定） | 持续保持 `on` |
| `read_ahead_kb` | `128` | **`1024`** | 持续保持 `1024` |
| `APM level` | `128` | **`254 (maximum performance)`** | **跨夜休眠后仍稳稳保持 `254`** |
| `193 Load_Cycle_Count` | `242,362`（**17.2 次/小时**） | `242,365` | `242,388`（10 小时仅 +23 次 ≈ **2.3 次/小时，暴降 86%**，且与 `Start_Stop` +23 次一一对应，运行期零无效归位） |
| `194 温度` | `46 °C`（最高 `52 °C`） | `39 °C` | **`34 °C`** |
| `199 UDMA_CRC` | `72` | `72` | **`72`（零增长）** |
| 服务状态 | `emby-server` / `lhm-agent` 运行 | 全部 `active` | 全部 `active`，`/media/usb` 属主保持 `emby:emby` |

---

## 5. 长期观察要点与故障预案

1. **通过本监控系统持续跟踪 4 项 SMART 指标**（在 Web 控制台「存储与 SMART」页面查看）：
   - `193 Load_Cycle_Count`（优化完成时基线：**`242,364`**）：若 1–2 天后增长明显放缓，说明 `APM=254` 持续稳定生效。
   - `4 Start_Stop_Count`（基线：**`19,208`**）：建议在 Emby 后台将媒体库定时扫描调整为每天一次或按需手动，可进一步降低主轴启停频率。
   - `194 Temperature_Celsius`：建议长期维持在 `≤ 50 °C`，夏季注意硬盘盒通风散热。
   - `199 UDMA_CRC_Error_Count`（基线：**`72`**）：只要数值保持 72 不再上涨，说明当前 USB 线缆与端口接触良好；若继续增长，优先更换短而粗的屏蔽 USB 3.0 数据线。
2. **关于 JMS578 休眠唤醒后 APM 可能复位的说明**：
   - 部分 JMS578 固件在经历一次盒体硬件停转休眠后再唤醒时，会将硬盘内部 APM 重置回 `128`。若后续观察到 `193 Load_Cycle_Count` 仍高频上涨，可执行 `sudo smartctl -g apm /dev/sdb` 核对；若确实被复位，再按需决定是否增加唤醒后恢复逻辑或调整休眠策略。
3. **仅在未来出现掉盘/UAS 报错时的降级预案（当前不需要）**：
   - 若 `dmesg` 未来出现 `uas_eh_abort_handler`、`reset SuperSpeed USB device` 或频繁掉盘，可在 `/etc/default/grub` 的 `GRUB_CMDLINE_LINUX_DEFAULT` 中加入 `usb-storage.quirks=152d:0578:u`，执行 `sudo update-grub` 并重启以切换为 `usb-storage` 兼容模式。

---

## 6. 系统盘 SSD（`/dev/sda`，256 GB M.2 SATA）长期延寿优化

针对 24/7 运行多容器的 256 GB 消费级 SSD（`SCY SNM4T1G25600D`，已通电 18,145 小时、`fstrim.timer` 已启用），已落地以下**零中断**减写与空间优化：

### 6.1 限制 `systemd-journald` 日志体积（释放 ~3.9 GB）

新增独立 drop-in 配置 `/etc/systemd/journald.conf.d/99-ssd-longevity.conf`（权限 `0644`）：

```ini
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=50M
MaxRetentionSec=14day
```

生效与清理命令：

```bash
sudo systemctl restart systemd-journald
sudo journalctl --vacuum-size=200M
sudo du -sh /var/log/journal
```

实测效果：`/var/log/journal` 从 **`4.1 GB` 降至 `178 MB`**。

### 6.2 降低 SSD Swap 写入与合并脏页回写

新增 `/etc/sysctl.d/99-ssd-longevity.conf`（权限 `0644`）：

```ini
# 降低向 SSD (/dev/sda3) 积极换出的倾向，并适度拉长脏页回写合并周期
vm.swappiness = 10
vm.dirty_writeback_centisecs = 1500
```

生效与验证命令：

```bash
sudo sysctl -p /etc/sysctl.d/99-ssd-longevity.conf
```

实测效果：`vm.swappiness` 从 `60` 降至 `10`，Swap 占用从 `3.0 GiB` 自然回落至 `2.8 GiB`。

### 6.3 根分区 `/` 启用 `noatime` 并热生效

修改前备份 `/etc/fstab` 至 `/etc/fstab.bak-20261120-root`，变更差异：

```diff
-UUID=473269c3-80e7-4e69-b744-3409fec214c7 /               ext4    errors=remount-ro 0       1
+UUID=473269c3-80e7-4e69-b744-3409fec214c7 /               ext4    noatime,errors=remount-ro 0       1
```

无中断热挂载并验证：

```bash
sudo systemctl daemon-reload
sudo mount -o remount,noatime /
findmnt -o SOURCE,TARGET,FSTYPE,OPTIONS /
# 预期：/dev/sda2 / ext4 rw,noatime,errors=remount-ro
```

### 6.4 清理 Docker 闲置构建缓存（为 SSD 留出磨损均衡空间）

```bash
docker builder prune -f
df -h /
```

实测效果：单次回收 **`32.51 GB`** 闲置构建缓存（未删除任何容器、镜像和数据卷）；叠加日志清理后，`/dev/sda2` 使用率从 **`65%`（已用 137G / 可用 77G）降至 `46%`（已用 98G / 可用 116G）**，为 SSD 控制器留出超过 50% 的可用余量以降低写放大（WAF）。

### 6.5 SSD 进一步可选优化建议（按需启用）

- **排查异常重启容器**：若发现容器处于无限 `restarting` 状态且未配置 Docker 日志上限，会持续高频刷写 `*-json.log` 并推高温度，建议定期用 `docker ps -a` 与 `docker system df` 巡检。
- **配置 Docker 全局日志上限**：可在维护窗口为 `/etc/docker/daemon.json` 增加 `"log-driver": "json-file"` 及 `"log-opts": { "max-size": "20m", "max-file": "3" }`（需重启 Docker 服务，且仅对新建容器生效）。
- **启用 `zram` 压缩内存交换**：若 7.5 GiB 内存长期运行大量容器导致 Swap 再次增长，可安装 `zram-tools` 让交换优先在内存中压缩完成，进一步减少 `/dev/sda3` 闪存擦写。

---

## 7. 一键回滚方案

### 7.1 回滚外接 USB 移动硬盘（`/dev/sdb`）优化

```bash
sudo cp -a /etc/fstab.bak-20261120 /etc/fstab
sudo rm -f /etc/udev/rules.d/99-usb-hdd-optimize.rules
sudo udevadm control --reload-rules
sudo systemctl daemon-reload
# 如需立即恢复原挂载参数（空闲时执行）：
sudo fuser -m /media/usb || (sudo umount /media/usb && sudo mount /media/usb)
```

### 7.2 回滚系统盘 SSD（`/dev/sda`）配置优化

```bash
sudo rm -f /etc/systemd/journald.conf.d/99-ssd-longevity.conf
sudo systemctl restart systemd-journald
sudo rm -f /etc/sysctl.d/99-ssd-longevity.conf
sudo sysctl -w vm.swappiness=60 vm.dirty_writeback_centisecs=500
sudo cp -a /etc/fstab.bak-20261120-root /etc/fstab
sudo systemctl daemon-reload
sudo mount -o remount,relatime /
```
