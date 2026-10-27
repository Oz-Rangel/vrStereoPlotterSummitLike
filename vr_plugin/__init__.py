from .vr_plugin import VrPlugin

def classFactory(iface):
    return VrPlugin(iface)
