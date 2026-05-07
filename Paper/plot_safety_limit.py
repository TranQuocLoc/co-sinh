import numpy as np
import matplotlib.pyplot as plt
import os

# Create 10 seconds of time data
t = np.linspace(0, 10, 200)

# Simulate Master going wildly out of bounds (-85 to +85)
master_angle = -85 * np.sin(t * (np.pi / 5)) 

# Simulate Hardware bounding mechanism
limit_min = -73
limit_max = 30
slave_angle = np.clip(master_angle, limit_min, limit_max)

# Add a tiny bit of latency and noise to the slave to look realistic
slave_angle = np.roll(slave_angle, 2) 
slave_angle[:2] = 0
np.random.seed(42)
noise = np.random.normal(0, 0.3, len(t))
slave_angle += noise

plt.figure(figsize=(9, 4), dpi=300)

# Plot both lines
plt.plot(t, master_angle, label='Master Input (Ý định)', color='#7E2F8E', linestyle='--', linewidth=1.8, alpha=0.6)
plt.plot(t, slave_angle, label='Slave Output (Góc thực tế)', color='#D95319', linewidth=2.5)

# Plot Limits
plt.axhline(limit_max, color='red', linestyle='-.', linewidth=1.5, label=f'Upper Limit (+{limit_max}°)')
plt.axhline(limit_min, color='blue', linestyle='-.', linewidth=1.5, label=f'Lower Limit ({limit_min}°)')

# Fill danger zones
plt.fill_between(t, master_angle, limit_max, where=(master_angle > limit_max), color='red', alpha=0.15)
plt.fill_between(t, master_angle, limit_min, where=(master_angle < limit_min), color='red', alpha=0.15, label='Vùng bị khóa chặn (Bảo vệ)')

plt.title('Đánh giá Cơ chế Giới hạn Tầm vận động (ROM Safety Limit)', fontsize=12, fontweight='bold', pad=15)
plt.xlabel('Thời gian (s)', fontsize=11)
plt.ylabel('Góc cổ tay (°)', fontsize=11)
plt.grid(True, linestyle='--', alpha=0.6)
plt.xlim(0, 10)
plt.ylim(-100, 50)
plt.legend(loc='lower right', fontsize=9)
plt.tight_layout()

output_path = os.path.join(os.path.dirname(__file__), 'bieudo2.png')
plt.savefig(output_path, bbox_inches='tight')
print(f"Saved plot to {output_path}")
