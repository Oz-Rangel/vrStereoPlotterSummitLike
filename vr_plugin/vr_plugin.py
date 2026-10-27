from qgis.PyQt.QtCore import QObject
from qgis.core import QgsApplication, QgsMessageLog
from qgis.utils import iface

class VrPlugin(QObject):

    def __init__(self, iface):
        super().__init__()
        self.iface = iface

    def initGui(self):
        # Add actions and menu items here
        pass

    def unload(self):
        # Remove actions and menu items here
        pass
