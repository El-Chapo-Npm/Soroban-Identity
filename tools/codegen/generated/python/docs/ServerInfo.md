# ServerInfo


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**version** | **str** |  | 
**api_version** | **str** |  | [optional] 
**supported_versions** | **List[str]** |  | [optional] 
**features** | **List[str]** |  | 
**min_sdk_version** | **str** |  | 

## Example

```python
from soroban_identity_client.models.server_info import ServerInfo

# TODO update the JSON string below
json = "{}"
# create an instance of ServerInfo from a JSON string
server_info_instance = ServerInfo.from_json(json)
# print the JSON string representation of the object
print(ServerInfo.to_json())

# convert the object into a dict
server_info_dict = server_info_instance.to_dict()
# create an instance of ServerInfo from a dict
server_info_from_dict = ServerInfo.from_dict(server_info_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


