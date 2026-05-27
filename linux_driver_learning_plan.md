# Linux 驱动开发学习计划（x86 QEMU 虚拟仿真版）

> **目标平台**：Ubuntu 26.04 LTS（x86_64）  
> **学习方式**：纯虚拟仿真，全程使用 QEMU  
> **前置基础**：C / Python / 基础 Linux 操作 / STM32 裸机经验 / ARM 设备使用经验  
> **预计周期**：16 ~ 20 周

---

## 目录

1. [方案概述](#一方案概述)
2. [核心技术路线](#二核心技术路线)
3. [Phase 0：环境搭建（第 1 周）](#phase-0环境搭建第-1-周)
4. [Phase 1：内核模块基础（第 2~3 周）](#phase-1内核模块基础第-23-周)
5. [Phase 2：字符设备驱动 + PCI 入门（第 4~6 周）](#phase-2字符设备驱动--pci-入门第-46-周)
6. [Phase 3：PCI 驱动深入 + QEMU 设备模型（第 7~9 周）](#phase-3pci-驱动深入--qemu-设备模型第-79-周)
7. [Phase 4：x86 常用子系统（第 10~14 周）](#phase-4x86-常用子系统第-1014-周)
8. [Phase 5：进阶主题 + 综合项目（第 15~20 周）](#phase-5进阶主题--综合项目第-1520-周)
9. [推荐参考资源](#九推荐参考资源)
10. [学习建议](#十学习建议)

---

## 一、方案概述

### 为什么选择 x86

| 维度 | 说明 |
|---|---|
| **零交叉编译** | QEMU x86_64 虚拟机内直接 gcc 编译，insmod 秒级反馈 |
| **QEMU `edu` 设备** | 官方教学 PCI 设备，MMIO / PIO / 中断 / DMA 全支持 |
| **gpio-mockup** | 纯虚拟 GPIO 控制器，内核内置，无需任何硬件 |
| **自建 QEMU 设备** | 用 C 写 QEMU 设备模型，从硬件侧理解驱动 |
| **Ubuntu 直接相关** | x86 架构与你目标平台完全一致 |
| **KVM 加速** | 原生硬件虚拟化加速，运行极流畅 |
| **PCI 为主总线** | x86 驱动开发的核心总线，学习价值更高 |

### 学习路径总览

```
Phase 0: 环境搭建
    ↓
Phase 1: 内核模块基础（sysfs / procfs / 内核编程）
    ↓
Phase 2: 字符设备驱动 + QEMU edu PCI 设备
    ↓
Phase 3: PCI 深入 + DMA + 自建 QEMU 设备模型
    ↓
Phase 4: GPIO / I2C / Input / RTC 子系统
    ↓
Phase 5: eBPF / kgdb 调试 + 综合虚拟外设项目
```

---

## 二、核心技术路线

```
宿主机 (Windows + WSL2 / Ubuntu 虚拟机)
    │
    ▼
QEMU x86_64 虚拟机 ─── 运行 Ubuntu Server
    │                      │
    │                      ├── gcc / make
    │                      ├── linux-headers$(uname -r)
    │                      └── 你的驱动模块 (.ko)
    │
    ▼
QEMU `-device` 参数 ─── 模拟虚拟硬件设备
    ├── edu        ── 官方教学 PCI 设备
    ├── i6300esb   ── PCI Watchdog
    ├── ich9-ahci  ── ICH9（含 I2C 控制器）
    └── 自建 QEMU 设备模型（进阶阶段）
```

---

## 三、Phase 0：环境搭建（第 1 周）

### 目标

跑起 QEMU x86_64 内核模块开发环境，完成第一个 "Hello World" 内核模块。

### 步骤

#### Step 1：安装 QEMU

```bash
# WSL2 / Ubuntu 宿主机
sudo apt update
sudo apt install qemu-system-x86 qemu-utils
```

#### Step 2：创建磁盘镜像并安装 Ubuntu

```bash
qemu-img create -f qcow2 ubuntu-driver-dev.qcow2 20G

qemu-system-x86_64 \
  -machine q35,accel=kvm \
  -cpu host \
  -smp 4 \
  -m 4096 \
  -drive file=ubuntu-24.04-server.iso,format=raw,if=ide \
  -drive file=ubuntu-driver-dev.qcow2,format=qcow2,if=virtio \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga virtio
```

#### Step 3：虚拟机内安装开发工具

```bash
sudo apt update
sudo apt install build-essential linux-headers-$(uname -r) git vim
```

#### Step 4：第一个内核模块

**hello.c**

```c
#include <linux/module.h>
#include <linux/init.h>

static int __init hello_init(void)
{
    pr_info("Hello, x86 Driver World!\n");
    return 0;
}

static void __exit hello_exit(void)
{
    pr_info("Goodbye, x86 Driver World!\n");
}

module_init(hello_init);
module_exit(hello_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Your Name");
MODULE_DESCRIPTION("First x86 kernel module");
```

**Makefile**

```makefile
obj-m += hello.o

all:
	make -C /lib/modules/$(shell uname -r)/build M=$(PWD) modules

clean:
	make -C /lib/modules/$(shell uname -r)/build M=$(PWD) clean
```

**编译 & 验证**

```bash
make
sudo insmod hello.ko
sudo rmmod hello.ko
dmesg | tail
```

预期输出：

```
[  xxx] Hello, x86 Driver World!
[  xxx] Goodbye, x86 Driver World!
```

### QEMU 一键启动脚本模板

**run_qemu.sh**

```bash
#!/bin/bash
# x86_64 驱动开发专用 QEMU 启动脚本

DISK_IMAGE=ubuntu-driver-dev.qcow2

qemu-system-x86_64 \
  -machine q35,accel=kvm \
  -cpu host \
  -smp 4 \
  -m 4096 \
  -drive file=$DISK_IMAGE,format=qcow2,if=virtio \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga virtio \
  -device edu \
  -device i6300esb \
  -device ich9-ahci \
  -serial stdio
```

---

## 四、Phase 1：内核模块基础（第 2~3 周）

### 学习内容

1. 模块的 `module_init` / `module_exit` 机制
2. 模块许可证 (`MODULE_LICENSE`)
3. 模块参数传递 (`module_param`)
4. 内核打印机制（`printk` / `pr_info` / `pr_err` / 日志级别）
5. `/sys` 与 `/proc` 内核接口
6. 内核内存分配 (`kmalloc` / `kzalloc` / `kfree`)
7. 内核链表 (`list_head`)
8. 内核定时器 (`timer_list` / `schedule_timeout`)

### 实践项目：虚拟系统监控模块

**功能**：收集虚拟机运行时状态，通过 `/proc/mymonitor` 展示

| 概念 | 对应实践 |
|---|---|
| `module_param` | `interval` 参数（采样间隔秒数） |
| `proc_create` | 创建 `/proc/mymonitor` 只读文件 |
| `timer_list` | 定时刷新监控数据 |
| `list_head` | 存储采样历史记录 |
| `copy_to_user` | 向用户态传递数据 |

**代码骨架**

```c
static int interval = 5;
module_param(interval, int, 0644);
MODULE_PARM_DESC(interval, "采样间隔（秒）");

static struct timer_list sample_timer;

static void sample_timer_cb(struct timer_list *t)
{
    /* 采集 CPU jiffies / 内存信息 */
    /* 更新 procfs 缓冲区 */
    mod_timer(&sample_timer, jiffies + msecs_to_jiffies(interval * 1000));
}

static int __init mon_init(void)
{
    /* 创建 /proc/mymonitor */
    /* 初始化定时器 */
    timer_setup(&sample_timer, sample_timer_cb, 0);
    mod_timer(&sample_timer, jiffies + msecs_to_jiffies(interval * 1000));
    return 0;
}
```

**验证方法**

```bash
# 默认 5 秒采样
sudo insmod sysmon.ko
cat /proc/mymonitor

# 修改采样间隔为 2 秒
sudo insmod sysmon.ko interval=2
```

---

## 五、Phase 2：字符设备驱动 + PCI 入门（第 4~6 周）

### 学习内容

1. `file_operations` 结构体：`open` / `release` / `read` / `write`
2. 主次设备号：动态分配 (`alloc_chrdev_region`)
3. `cdev` 接口使用
4. `udev` 自动创建设备节点（`class_create` / `device_create`）
5. `copy_from_user` / `copy_to_user`
6. `unlocked_ioctl` 接口
7. 阻塞 I/O 与等待队列 (`wait_queue_head_t`)
8. PCI 子系统基础：`pci_driver` / `pci_device_id`
9. MMIO 内存映射：`pci_ioremap_bar`

### 关于 QEMU `edu` 设备

`edu` 是 QEMU 内置的教学 PCI 设备，启动时添加 `-device edu` 即可。

```bash
# 虚拟机内查看
lspci -nn | grep 1234
# 输出: 00:04.0 Unclassified device [00ff]: Device 1234:11e8 (rev 10)
```

**`edu` 设备功能映射**

| BAR0 偏移 | 访问方式 | 功能 |
|---|---|---|
| `0x00` | 读 | 返回 `0x1234`（厂商标识） |
| `0x04` | 读 | 读时自动递增的计数器 |
| `0x08` | 写 | 写入要计算阶乘的值 |
| `0x20` | 读 | 读取阶乘计算结果 |
| `0x60` | 读写 | 中断控制寄存器 |
| `0x80` | 读写 | DMA 源地址 |
| `0x84` | 读写 | DMA 目标地址 |
| `0x88` | 读写 | DMA 传输计数 |
| `0x8C` | 写 | DMA 命令触发 |
| **IO Port `0x0`** | 读写 | PIO 方式访问（可对比 MMIO） |

### 实践项目 1：edu PCI 基础驱动

**功能**：
- probe 阶段获取 PCI BAR0 并 ioremap
- 通过 read 读取实时递增计数器
- 通过 ioctl 配置和读取设备状态

```c
#include <linux/module.h>
#include <linux/pci.h>
#include <linux/cdev.h>
#include <linux/fs.h>

#define EDU_VENDOR_ID  0x1234
#define EDU_DEVICE_ID  0x11e8
#define EDU_BAR0       0

#define EDU_REG_ID     0x00
#define EDU_REG_LIVE   0x04
#define EDU_REG_FACT   0x08
#define EDU_REG_FACT_R 0x20

struct edu_dev {
    struct pci_dev *pdev;
    void __iomem *bar0;
    struct cdev cdev;
    dev_t devno;
};

static const struct pci_device_id edu_pci_ids[] = {
    { PCI_DEVICE(EDU_VENDOR_ID, EDU_DEVICE_ID) },
    { /* sentinel */ }
};
MODULE_DEVICE_TABLE(pci, edu_pci_ids);

static int edu_probe(struct pci_dev *pdev, const struct pci_device_id *id)
{
    struct edu_dev *dev;
    int ret;

    dev = devm_kzalloc(&pdev->dev, sizeof(*dev), GFP_KERNEL);

    ret = pcim_enable_device(pdev);
    if (ret) return ret;

    ret = pcim_iomap_regions(pdev, BIT(EDU_BAR0), "edu");
    if (ret) return ret;

    dev->bar0 = pcim_iomap_table(pdev)[EDU_BAR0];
    dev->pdev = pdev;

    /* 验证设备：读取 0x00 应返回 0x1234 */
    u32 id_val = ioread32(dev->bar0 + EDU_REG_ID);
    dev_info(&pdev->dev, "EDU ID: 0x%08x\n", id_val);

    /* 注册字符设备 */
    /* ... */

    pci_set_drvdata(pdev, dev);
    return 0;
}

static int edu_read(struct file *filp, char __user *buf, size_t len, loff_t *off)
{
    struct edu_dev *dev = filp->private_data;
    u32 live_val = ioread32(dev->bar0 + EDU_REG_LIVE);
    /* 复制到用户态 */
    return 0;
}

static const struct file_operations edu_fops = {
    .owner   = THIS_MODULE,
    .open    = edu_open,
    .release = edu_release,
    .read    = edu_read,
    .unlocked_ioctl = edu_ioctl,
};
```

### 实践项目 2：阶乘加速器（ioctl 实现）

Linux 驱动侧：

```c
#define EDU_IOCTL_BASE  'E'
#define EDU_CALC_FACT   _IOWR(EDU_IOCTL_BASE, 1, unsigned long)

static long edu_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
{
    struct edu_dev *dev = filp->private_data;

    switch (cmd) {
    case EDU_CALC_FACT:;
        u32 input, result;
        copy_from_user(&input, (void __user *)arg, sizeof(input));

        /* 写入阶乘值到 0x08，触发计算 */
        iowrite32(input, dev->bar0 + EDU_REG_FACT);

        /* 等待计算完成 */
        result = ioread32(dev->bar0 + EDU_REG_FACT_R);

        copy_to_user((void __user *)arg, &result, sizeof(result));
        return 0;
    }
    return -EINVAL;
}
```

用户态测试：

```c
// edu_test.c
#include <stdio.h>
#include <fcntl.h>
#include <sys/ioctl.h>

#define EDU_IOCTL_BASE  'E'
#define EDU_CALC_FACT   _IOWR(EDU_IOCTL_BASE, 1, unsigned long)

int main()
{
    int fd = open("/dev/edu", O_RDWR);
    unsigned long input = 5, result;

    ioctl(fd, EDU_CALC_FACT, &result);
    printf("5! = %lu\n", result);  // 预期 120

    close(fd);
    return 0;
}
```

---

## 六、Phase 3：PCI 驱动深入 + QEMU 设备模型（第 7~9 周）

### 学习内容

1. PCI 配置空间深度解析（Vendor/Device ID、BAR、Class Code、Capability 链表）
2. PCI 拓扑结构（Bus / Device / Function）
3. MSI / MSI-X 中断（`pci_alloc_irq_vectors`）
4. 内核中断下半部（Tasklet / Workqueue / Threaded IRQ）
5. DMA API（`dma_alloc_coherent` / `dma_map_single` / streaming DMA 映射）
6. 使用 C 语言编写 QEMU PCI 设备模型
7. 内核并发控制（spinlock / mutex / RCU 的选择策略）

### 实践项目 1：edu DMA 数据传输

edu 设备 DMA 寄存器：

| BAR0 偏移 | 操作 | 说明 |
|---|---|---|
| `0x80` | 写 | DMA 源地址（物理地址） |
| `0x84` | 写 | DMA 目标地址（物理地址） |
| `0x88` | 写 | 传输字节数 |
| `0x8C` | 写 1 | 触发 DMA 传输 |

驱动实现：

```c
static int edu_dma_transfer(struct edu_dev *dev, void *src, void *dst, size_t len)
{
    dma_addr_t src_dma, dst_dma;

    src_dma = dma_map_single(&dev->pdev->dev, src, len, DMA_TO_DEVICE);
    dst_dma = dma_map_single(&dev->pdev->dev, dst, len, DMA_FROM_DEVICE);

    iowrite32((u32)src_dma, dev->bar0 + 0x80);
    iowrite32((u32)dst_dma, dev->bar0 + 0x84);
    iowrite32((u32)len,     dev->bar0 + 0x88);
    iowrite32(1,            dev->bar0 + 0x8C);  /* 触发 */

    /* 等待 DMA 完成（轮询或中断） */

    dma_unmap_single(&dev->pdev->dev, src_dma, len, DMA_TO_DEVICE);
    dma_unmap_single(&dev->pdev->dev, dst_dma, len, DMA_FROM_DEVICE);

    return 0;
}
```

### 实践项目 2：自建 QEMU PCI 设备

这是最有价值的进阶环节——你写 QEMU 设备模型，再写 Linux 驱动去驱动它，完全掌控硬件-驱动全链路。

**QEMU 设备模型** `hw/misc/mydevice.c`：

```c
#include "qemu/osdep.h"
#include "hw/pci/pci.h"
#include "hw/pci/msi.h"
#include "qemu/log.h"

#define TYPE_MY_DEVICE "my-device"
OBJECT_DECLARE_SIMPLE_TYPE(MyDeviceState, MY_DEVICE)

#define MY_VENDOR_ID  0x1A2B
#define MY_DEVICE_ID  0x3C4D

typedef struct {
    PCIDevice parent;
    MemoryRegion mmio;
    uint32_t status_reg;
    uint32_t data_buf[256];
} MyDeviceState;

static uint64_t mydev_mmio_read(void *opaque, hwaddr addr, unsigned size)
{
    MyDeviceState *dev = opaque;
    switch (addr) {
    case 0x00: return 0xDEADBEEF;  /* 只读标识 */
    case 0x04: return dev->status_reg;
    default:
        if (addr >= 0x100 && addr < 0x500)
            return dev->data_buf[(addr - 0x100) / 4];
        return 0;
    }
}

static void mydev_mmio_write(void *opaque, hwaddr addr,
                              uint64_t val, unsigned size)
{
    MyDeviceState *dev = opaque;
    switch (addr) {
    case 0x04: dev->status_reg = val; break;
    case 0x08: /* 触发中断 */ break;
    default:
        if (addr >= 0x100 && addr < 0x500)
            dev->data_buf[(addr - 0x100) / 4] = val;
    }
}

static const MemoryRegionOps mydev_mmio_ops = {
    .read = mydev_mmio_read,
    .write = mydev_mmio_write,
    .endianness = DEVICE_LITTLE_ENDIAN,
    .impl.min_access_size = 4,
    .impl.max_access_size = 4,
};

static void mydev_realize(PCIDevice *pci_dev, Error **errp)
{
    MyDeviceState *dev = MY_DEVICE(pci_dev);

    memory_region_init_io(&dev->mmio, OBJECT(dev),
                          &mydev_mmio_ops, dev, "mydev-mmio", 0x1000);
    pci_register_bar(pci_dev, 0, PCI_BASE_ADDRESS_SPACE_MEMORY, &dev->mmio);
}

static void mydev_class_init(ObjectClass *klass, void *data)
{
    DeviceClass *dc = DEVICE_CLASS(klass);
    PCIDeviceClass *k = PCI_DEVICE_CLASS(klass);

    k->vendor_id = MY_VENDOR_ID;
    k->device_id = MY_DEVICE_ID;
    k->revision = 0x10;
    k->class_id = PCI_CLASS_OTHERS;
    k->realize = mydev_realize;
    dc->desc = "My Custom PCI Device";
}

static const TypeInfo mydev_info = {
    .name = TYPE_MY_DEVICE,
    .parent = TYPE_PCI_DEVICE,
    .instance_size = sizeof(MyDeviceState),
    .class_init = mydev_class_init,
};

static void mydev_register(void)
{
    type_register_static(&mydev_info);
}
type_init(mydev_register);
```

启动 QEMU：

```bash
qemu-system-x86_64 ... -device my-device
```

虚拟机内：

```bash
lspci -nn | grep 1a2b
# 编写 Linux 驱动匹配 Vendor=0x1A2B, Device=0x3C4D
```

---

## 七、Phase 4：x86 常用子系统（第 10~14 周）

### 子系统总览

| 子系统 | x86 学习方式 | QEMU 方案 |
|---|---|---|
| **GPIO** | `gpio-mockup` 纯虚拟 GPIO 控制器 | 内核内置，`modprobe gpio-mockup` 即可 |
| **I2C** | QEMU ICH9 芯片组 I2C 控制器 | `-device ich9-ahci` 附赠 |
| **Input** | 输入子系统（evdev / input_dev） | QEMU USB 键盘鼠标自动模拟 |
| **RTC** | MC146818 CMOS RTC | QEMU 默认提供 |
| **Framebuffer** | bochs-drm / virtio-gpu DRM | `-vga virtio` |
| **Watchdog** | i6300esb PCI watchdog | `-device i6300esb` |

### 实践项目 1：gpio-mockup 虚拟按键驱动

`gpio-mockup` 是内核内置的纯虚拟 GPIO 控制器：

```bash
# 加载 8 个虚拟 GPIO，模拟两个物理 line bank
sudo modprobe gpio-mockup gpio_mockup_ranges=-1,8
```

```bash
# 验证
ls /sys/class/gpio/
# 预期出现 gpiochipX 设备

# 查看虚拟 GPIO 状态
cat /sys/kernel/debug/gpio
```

编写驱动使用 `gpiod` API 获取虚拟 GPIO，注册为 input 设备：

```c
static struct gpio_desc *button_gpio;
static struct input_dev *input_dev;

static int __init vbutton_init(void)
{
    /* 通过 gpio-mockup chip label 获取 GPIO */
    button_gpio = gpiod_get(NULL, NULL, GPIOD_IN);

    /* 注册 input 设备 */
    input_dev = input_allocate_device();
    input_dev->name = "Virtual Button";
    set_bit(EV_KEY, input_dev->evbit);
    set_bit(KEY_ENTER, input_dev->keybit);

    /* 注册中断检测 GPIO 边沿 */
    ret = gpiod_to_irq(button_gpio);

    ret = request_threaded_irq(irq, NULL, button_isr,
                                IRQF_TRIGGER_RISING, "vbutton", NULL);

    return input_register_device(input_dev);
}
```

改变 GPIO 值触发中断（通过操作 `gpio-mockup` 的 debugfs/sysfs）：

```bash
# 通过内核 debugfs 操作 gpio-mockup 值
# 或通过加载时指定 GPIO 初始值
# 更简单：使用 libgpiod 工具
sudo gpioset gpiochip0 0=1
sudo gpioset gpiochip0 0=0  # 下降沿触发 IRQ
```

### 实践项目 2：RTC 驱动实验

x86 上 MC146818 RTC 通过 IO 端口 `0x70` / `0x71` 访问：

```c
static u8 cmos_read(u8 reg)
{
    u8 val;
    outb(reg, 0x70);
    val = inb(0x71);
    return val;
}

/* 读取当前时间 */
u8 sec  = cmos_read(0x00);
u8 min  = cmos_read(0x02);
u8 hour = cmos_read(0x04);
u8 day  = cmos_read(0x07);
u8 mon  = cmos_read(0x08);
u8 year = cmos_read(0x09);
```

**验证**：与 `/sys/class/rtc/rtc0/time` 对比

### 实践项目 3：I2C 虚拟传感器

QEMU 的 ICH9 芯片组包含 I2C 控制器。可通过 QEMU 源码添加一个虚拟 I2C 从设备，或模拟 I2C 设备寄存器。

设备树 ACPI 方式（x86 上 ACPI 替代 DT）：

```c
// 通过 ACPI 表匹配（x86 典型方式）
static const struct acpi_device_id myi2c_acpi_match[] = {
    { "MYSC0001", 0 },
    { /* sentinel */ }
};
MODULE_DEVICE_TABLE(acpi, myi2c_acpi_match);

static struct i2c_driver myi2c_driver = {
    .driver = {
        .name = "my-sensor",
        .acpi_match_table = myi2c_acpi_match,
    },
    .probe = myi2c_probe,
    .id_table = myi2c_id,
};
```

---

## 八、Phase 5：进阶主题 + 综合项目（第 15~20 周）

### 进阶主题

#### 1. ACPI 驱动开发

```bash
# 虚拟机内反编译 ACPI 表
sudo apt install acpica-tools
cat /sys/firmware/acpi/tables/DSDT > dsdt.dat
iasl -d dsdt.dat
# 阅读反编译的 DSDT.dsl，理解 ACPI 设备描述
```

- 解析 DSDT / SSDT 表
- 编写 ACPI 平台驱动（`acpi_bus_type`）
- 对比 ACPI 与 Device Tree 的设计哲学

#### 2. KVM 与 virtio

- 理解半虚拟化（virtio）与全虚拟化的区别
- 阅读 virtio-pci / virtio-blk 驱动源码
- QEMU + KVM 是实现 virtio 的完整参考

#### 3. eBPF 内核追踪

```bash
sudo apt install bpftrace bpfcc-tools
# 追踪驱动函数调用
sudo bpftrace -e 'kprobe:edu_read { printf("edu_read called\n"); }'
```

- `bpftrace` 动态追踪驱动行为
- `libbpf` 编写 BPF 程序监控内核事件

#### 4. kgdb + QEMU 内核调试

```bash
# QEMU 侧：-s 参数启动 gdbserver
qemu-system-x86_64 ... -s

# 宿主机侧：连接 gdb
gdb vmlinux
(gdb) target remote localhost:1234
(gdb) break edu_read
(gdb) continue
```

- 单步调试内核和驱动
- 查看内核数据结构
- 分析 Oops / Panic 的 Call Trace

### 综合项目：x86 虚拟外设全家桶

```
x86_driver_lab/
├── drivers/
│   ├── edu_basic/          # edu PCI MMIO/PIO 基础交互
│   ├── edu_factorial/      # edu 阶乘加速器（ioctl）
│   ├── edu_dma/            # edu DMA 数据传输
│   ├── edu_interrupt/      # edu 中断处理实验
│   ├── mypci/              # 自建 QEMU PCI 设备驱动
│   ├── gpio_buttons/       # gpio-mockup 虚拟按键
│   └── mysensor_i2c/       # I2C 虚拟传感器
├── qemu_devices/
│   ├── hw/misc/mydevice.c  # 自定义 PCI 设备
│   └── hw/i2c/mysensor.c   # 自定义 I2C 从设备
├── userspace/
│   ├── edu_test.c          # edu 全套功能测试
│   ├── sensor_monitor.py   # Python sysfs 监控脚本
│   └── benchmark.sh        # 驱动性能测试脚本
├── run_qemu.sh             # 启动脚本（含全部 -device）
└── Makefile                # 顶层编译
```

**Python 监控脚本示例**：

```python
#!/usr/bin/env python3
# sensor_monitor.py — 通过 sysfs 监控虚拟传感器

import os
import time
import signal

SENSOR_PATH = "/sys/bus/i2c/devices/0-0048"

def read_temperature():
    with open(f"{SENSOR_PATH}/temperature") as f:
        return int(f.read().strip()) / 1000.0

def read_humidity():
    with open(f"{SENSOR_PATH}/humidity") as f:
        return int(f.read().strip()) / 1000.0

def signal_handler(sig, frame):
    print("\nMonitoring stopped.")
    exit(0)

signal.signal(signal.SIGINT, signal_handler)
print("Sensor Monitor Started (Ctrl+C to stop)")
print("=" * 40)

while True:
    temp = read_temperature()
    hum = read_humidity()
    print(f"[{time.strftime('%H:%M:%S')}] Temp: {temp:.2f}°C  Humidity: {hum:.2f}%")
    time.sleep(1)
```

---

## 九、推荐参考资源

| 资源 | 类型 | 说明 |
|---|---|---|
| **《Linux Device Drivers, 3rd Edition》** (LDD3) | 书籍 | 经典圣经，免费在线版，2.6 内核但核心概念不变 |
| **《Linux Kernel Development》** (Robert Love) | 书籍 | 内核设计与内部机制理解 |
| **内核官方文档** `Documentation/driver-api/` | 文档 | 最权威最新的驱动 API 参考 |
| **Bootlin ELDD 培训资料** | 培训 | https://bootlin.com/doc/training/linux-kernel/ |
| **QEMU 源码** `hw/misc/edu.c` | 源码 | edu 设备完整实现，学习如何编写 QEMU 设备模型 |
| **QEMU 源码** `hw/pci/` | 源码 | PCI 设备模拟的完整参考 |
| **Linux 内核源码** `drivers/` | 源码 | 大量工业级驱动参考 |
| **LWN Kernel Index** | 文章 | https://lwn.net/Kernel/Index/ |

---

## 十、学习建议

1. **不要跳阶段**：内核模块 → 字符设备 → PCI → 子系统，层层递进
2. **每次必验证**：每个驱动写完都要有对应的用户态测试程序
3. **善用内核调试**：`printk` 是基础，尽早学习 `ftrace` 和 `kgdb`
4. **多看内核源码**：`drivers/` 目录下有很多优秀参考驱动，尤其是 `drivers/misc/` 和 `drivers/i2c/`
5. **关注内核错误**：学会分析 `dmesg` 中的 Oops 信息和 Call Trace
6. **版本兼容性**：以 Linux 主线 LTS 版本为准，API 变化关注主线更新
7. **QEMU 技巧**：`-s -S` + gdb 可单步调试内核和驱动
8. **善用 `git`**：用 git 管理驱动代码，每次改动都能回退
9. **记录实验日志**：每个实践项目记录成功/失败的关键点
10. **结合已有经验**：你 STM32 的寄存器操作经验能直接迁移到 ioread/iowrite 和 MMIO 操作

---

> **最后说明**：本计划全程基于 QEMU x86_64 虚拟仿真，无需任何真实硬件。所有驱动均可在虚拟机内编译、加载、测试、调试，形成一个完整的「学习 → 实践 → 验证」闭环。核心目标不是"学过"，而是每个阶段都有可运行的代码产出。